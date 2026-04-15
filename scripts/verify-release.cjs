const path = require("path");
const { spawn } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const allowReadinessWarnings = process.argv.includes("--allow-readiness-warnings");

const steps = [
  {
    name: "Frontend lint",
    command: npmCommand,
    args: ["--prefix", "frontend", "run", "lint"],
  },
  {
    name: "Frontend build",
    command: npmCommand,
    args: ["--prefix", "frontend", "run", "build"],
  },
  {
    name: "Backend runtime verification",
    command: npmCommand,
    args: ["--prefix", "backend", "run", "verify:runtime"],
  },
  {
    name: "Backend transaction verification",
    command: npmCommand,
    args: ["--prefix", "backend", "run", "verify:transactions"],
  },
  {
    name: "Backend backup verification",
    command: npmCommand,
    args: ["--prefix", "backend", "run", "verify:backup"],
  },
  {
    name: "Backend backup restore drill",
    command: npmCommand,
    args: ["--prefix", "backend", "run", "verify:restore"],
  },
  {
    name: "Backend deployment readiness",
    command: npmCommand,
    args: ["--prefix", "backend", "run", "verify:readiness"],
    allowExitCodes: allowReadinessWarnings ? [0, 2] : [0],
  },
];

function runStep(step) {
  return new Promise((resolve) => {
    const invocation =
      process.platform === "win32"
        ? {
            command: "cmd.exe",
            args: ["/d", "/s", "/c", step.command, ...step.args],
          }
        : {
            command: step.command,
            args: step.args,
          };

    const child = spawn(invocation.command, invocation.args, {
      cwd: rootDir,
      stdio: "inherit",
      shell: false,
    });

    child.on("exit", (code) => {
      resolve(typeof code === "number" ? code : 1);
    });

    child.on("error", () => {
      resolve(1);
    });
  });
}

async function main() {
  console.log(
    allowReadinessWarnings
      ? "Running AfroSpice release gate (allowing readiness warnings for local validation)..."
      : "Running AfroSpice strict release gate..."
  );

  for (const step of steps) {
    console.log(`\n>>> ${step.name}`);
    const exitCode = await runStep(step);
    const allowedCodes = Array.isArray(step.allowExitCodes) ? step.allowExitCodes : [0];

    if (!allowedCodes.includes(exitCode)) {
      console.error(`\nRelease gate failed during: ${step.name}`);
      process.exit(exitCode || 1);
    }
  }

  if (allowReadinessWarnings) {
    console.log("\nPASS: Local release validation completed. Readiness warnings were allowed.");
    return;
  }

  console.log("\nPASS: Strict release gate completed successfully.");
}

main().catch((error) => {
  console.error("Release gate failed:", error?.message || error);
  process.exit(1);
});
