const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, "src", ".env"),
});

const runtime = require("./src/config/runtime");
runtime.assertRuntimeConfig();
const { disconnectDB } = require("./src/config/db");
const { stopDevMemoryMongo } = require("./src/config/devMemoryMongo");
const { stopLocalReplicaSet } = require("./src/config/localReplicaSet");

const app = require("./src/app");

const PORT = Number(process.env.PORT) || 3000;
let server = null;

async function startServer() {
  await app.initialize();
  server = app.listen(PORT, () => {
    console.log(`AfroSpice backend running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Server startup failed:", error);
  process.exit(1);
});

async function shutdown(code = 0) {
  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await disconnectDB();
    await stopLocalReplicaSet();
    await stopDevMemoryMongo();
  } catch (error) {
    console.error("Shutdown error:", error);
    code = 1;
  }

  process.exit(code);
}

process.on("unhandledRejection", async (error) => {
  console.error("Unhandled Rejection:", error);
  await shutdown(1);
});

process.on("uncaughtException", async (error) => {
  console.error("Uncaught Exception:", error);
  await shutdown(1);
});
