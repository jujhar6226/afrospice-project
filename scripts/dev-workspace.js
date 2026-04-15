const { spawn } = require("child_process");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const backendDir = path.join(rootDir, "backend");
const frontendDir = path.join(rootDir, "frontend");

const npmCommand = process.platform === "win32" ? "cmd.exe" : "npm";
const npmArgs = process.platform === "win32" ? ["/c", "npm run dev"] : ["run", "dev"];
const safeEnv = buildSafeEnv();

function buildSafeEnv() {
  if (process.platform !== "win32") {
    return process.env;
  }

  const env = {};
  const seen = new Set();

  for (const [key, value] of Object.entries(process.env)) {
    const normalized = key.toLowerCase();
    if (normalized === "path") {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    env[key] = value;
    seen.add(normalized);
  }

  env.Path = process.env.Path || process.env.PATH || "";
  return env;
}

function spawnProcess(command, args, cwd, label) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    env: safeEnv,
  });

  child.on("error", (error) => {
    console.error(`[${label}] failed to start:`, error.message || error);
  });

  child.on("exit", (code, signal) => {
    const exitCode = typeof code === "number" ? code : `signal:${signal}`;
    console.log(`[${label}] exited (${exitCode}).`);
  });

  return child;
}

function stopChild(child) {
  if (!child || child.killed) return;
  try {
    child.kill("SIGINT");
  } catch {
    // no-op
  }
}

console.log("Starting AfroSpice workspace dev environment...");
console.log(`Backend:  ${backendDir}`);
console.log(`Frontend: ${frontendDir}`);

const backend = spawnProcess(process.execPath, ["server.js"], backendDir, "backend");
const frontend = spawnProcess(npmCommand, npmArgs, frontendDir, "frontend");

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("Stopping workspace processes...");
  stopChild(frontend);
  stopChild(backend);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

backend.on("exit", () => {
  if (!shuttingDown) {
    console.log("Backend stopped, shutting down frontend.");
    shutdown();
  }
});

frontend.on("exit", () => {
  if (!shuttingDown) {
    console.log("Frontend stopped, shutting down backend.");
    shutdown();
  }
});
