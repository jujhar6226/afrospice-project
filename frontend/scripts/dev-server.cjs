const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const frontendDir = path.resolve(__dirname, "..");
const rootDir = path.resolve(frontendDir, "..");
const backendDir = path.join(rootDir, "backend");
const BACKEND_HEALTH_URL = "http://127.0.0.1:5000/api/system/health";
const viteBinPath = path.join(frontendDir, "node_modules", "vite", "bin", "vite.js");

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

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function checkBackendHealth(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const request = http.get(BACKEND_HEALTH_URL, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });

    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });

    request.on("error", () => {
      resolve(false);
    });
  });
}

async function waitForBackend(maxAttempts = 20) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await checkBackendHealth()) {
      return true;
    }
    await wait(500);
  }

  return false;
}

function spawnProcess(command, args, cwd, env, label) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    env,
  });

  child.on("error", (error) => {
    console.error(`[${label}] failed to start:`, error.message || error);
  });

  return child;
}

async function main() {
  const env = buildSafeEnv();
  let backendProcess = null;
  let frontendProcess = null;
  let startedBackend = false;
  let shuttingDown = false;

  const backendIsLive = await checkBackendHealth();

  if (!backendIsLive) {
    console.log("Backend not detected on 127.0.0.1:5000. Starting local backend...");
    backendProcess = spawnProcess(process.execPath, ["server.js"], backendDir, env, "backend");
    startedBackend = true;

    const backendReady = await waitForBackend();
    if (!backendReady) {
      console.error("Backend did not become healthy on http://127.0.0.1:5000.");
      if (backendProcess && !backendProcess.killed) {
        backendProcess.kill("SIGINT");
      }
      process.exit(1);
    }
  } else {
    console.log("Backend already running on 127.0.0.1:5000.");
  }

  console.log("Starting frontend on http://127.0.0.1:5173...");
  frontendProcess = spawnProcess(
    process.execPath,
    [viteBinPath, "--configLoader", "native"],
    frontendDir,
    env,
    "frontend"
  );

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (frontendProcess && !frontendProcess.killed) {
      frontendProcess.kill("SIGINT");
    }

    if (startedBackend && backendProcess && !backendProcess.killed) {
      backendProcess.kill("SIGINT");
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  frontendProcess.on("exit", (code) => {
    if (!shuttingDown) {
      shutdown();
      process.exit(typeof code === "number" ? code : 0);
    }
  });

  if (backendProcess) {
    backendProcess.on("exit", (code) => {
      if (!shuttingDown) {
        console.error(`[backend] exited early (${typeof code === "number" ? code : "unknown"}).`);
        shutdown();
        process.exit(typeof code === "number" ? code : 1);
      }
    });
  }
}

main().catch((error) => {
  console.error("Workspace dev launcher failed:", error);
  process.exit(1);
});
