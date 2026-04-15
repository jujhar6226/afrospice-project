const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn, execSync } = require("child_process");
const runtime = require("./runtime");
const { mongo: mongoDriver } = require("mongoose");

const { MongoClient } = mongoDriver;

const LOCAL_REPLICA_SET_NAME = process.env.LOCAL_REPLICA_SET_NAME || "rs0";
const LOCAL_REPLICA_HOST = process.env.LOCAL_REPLICA_HOST || "127.0.0.1";
const LOCAL_REPLICA_PORT = Number(process.env.LOCAL_REPLICA_PORT || 27018);
const LOCAL_REPLICA_DB = process.env.LOCAL_REPLICA_DB || "afrospice";
const DEFAULT_WINDOWS_MONGOD_PATH = "C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe";

function resolveLocalMongodPath() {
  const fromEnv = String(process.env.LOCAL_REPLICA_MONGOD_PATH || "").trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (process.platform === "win32") {
    return DEFAULT_WINDOWS_MONGOD_PATH;
  }
  try {
    const found = execSync("command -v mongod", { encoding: "utf8" }).trim();
    if (found) {
      return found;
    }
  } catch {
    // ignore — fall back to PATH name
  }
  return "mongod";
}

const LOCAL_MONGOD_PATH = resolveLocalMongodPath();
const REPLICA_ROOT = path.resolve(__dirname, "..", "..", "var", "mongo-rs");
const REPLICA_DATA_DIR = path.join(REPLICA_ROOT, "data");
const REPLICA_LOG_PATH = path.join(REPLICA_ROOT, "mongod.log");
const REPLICA_PID_PATH = path.join(REPLICA_ROOT, "mongod.pid");
let localReplicaChild = null;

function buildReplicaUri(database = LOCAL_REPLICA_DB) {
  return `mongodb://${LOCAL_REPLICA_HOST}:${LOCAL_REPLICA_PORT}/${database}?replicaSet=${LOCAL_REPLICA_SET_NAME}`;
}

function buildDirectAdminUri() {
  return `mongodb://${LOCAL_REPLICA_HOST}:${LOCAL_REPLICA_PORT}/admin?directConnection=true`;
}

function shouldManageLocalReplica(uri = process.env.MONGO_URI || runtime.mongoUri) {
  if (!uri) return false;

  try {
    const parsed = new URL(uri);
    const requestedReplicaSet = parsed.searchParams.get("replicaSet");
    const isLocalHost =
      parsed.hostname === LOCAL_REPLICA_HOST &&
      Number(parsed.port || 27017) === LOCAL_REPLICA_PORT;

    return isLocalHost && requestedReplicaSet === LOCAL_REPLICA_SET_NAME;
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function ensureReplicaDirectories() {
  fs.mkdirSync(REPLICA_DATA_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(REPLICA_LOG_PATH), { recursive: true });
}

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("error", () => {
      resolve(false);
    });

    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(host, port, attempts = 40, delayMs = 500) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isPortOpen(host, port)) {
      return true;
    }
    await wait(delayMs);
  }

  return false;
}

function startLocalReplicaProcess() {
  if (localReplicaChild && !localReplicaChild.killed) {
    return localReplicaChild;
  }

  ensureReplicaDirectories();

  const mongodLooksLikePath =
    path.isAbsolute(LOCAL_MONGOD_PATH) || LOCAL_MONGOD_PATH.includes(path.sep);
  if (mongodLooksLikePath && !fs.existsSync(LOCAL_MONGOD_PATH)) {
    throw new Error(
      `mongod binary was not found at ${LOCAL_MONGOD_PATH}. Install MongoDB or set LOCAL_REPLICA_MONGOD_PATH.`
    );
  }

  const args = [
    "--dbpath",
    REPLICA_DATA_DIR,
    "--port",
    String(LOCAL_REPLICA_PORT),
    "--bind_ip",
    LOCAL_REPLICA_HOST,
    "--replSet",
    LOCAL_REPLICA_SET_NAME,
    "--logpath",
    REPLICA_LOG_PATH,
    "--logappend",
    "--pidfilepath",
    REPLICA_PID_PATH,
  ];

  const child = spawn(LOCAL_MONGOD_PATH, args, {
    stdio: "ignore",
    windowsHide: true,
  });

  child.on("exit", () => {
    localReplicaChild = null;
  });

  child.unref();
  localReplicaChild = child;
  return child;
}

async function withClient(uri, fn) {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();

  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function ensureReplicaInitiated() {
  const adminUri = buildDirectAdminUri();

  return withClient(adminUri, async (client) => {
    const admin = client.db("admin");

    try {
      const hello = await admin.command({ hello: 1 });
      if (hello.setName === LOCAL_REPLICA_SET_NAME) {
        return "already-initialized";
      }
    } catch {
      // fall through to initiate path
    }

    try {
      await admin.command({
        replSetInitiate: {
          _id: LOCAL_REPLICA_SET_NAME,
          members: [{ _id: 0, host: `${LOCAL_REPLICA_HOST}:${LOCAL_REPLICA_PORT}` }],
        },
      });
      return "initiated";
    } catch (error) {
      const message = String(error?.message || "");
      const alreadyInitialized =
        error?.codeName === "AlreadyInitialized" ||
        /already initialized/i.test(message);

      if (alreadyInitialized) {
        return "already-initialized";
      }

      throw error;
    }
  });
}

async function getReplicaHello() {
  return withClient(buildDirectAdminUri(), async (client) => {
    const admin = client.db("admin");
    return await admin.command({ hello: 1 });
  });
}

async function ensureLocalReplicaSet(uri = process.env.MONGO_URI || runtime.mongoUri) {
  if (!shouldManageLocalReplica(uri)) {
    return {
      managed: false,
      reason: "runtime-uri-does-not-target-local-replica",
      uri,
    };
  }

  const alreadyRunning = await isPortOpen(LOCAL_REPLICA_HOST, LOCAL_REPLICA_PORT);
  if (!alreadyRunning) {
    startLocalReplicaProcess();
  }

  const online = await waitForPort(LOCAL_REPLICA_HOST, LOCAL_REPLICA_PORT);
  if (!online) {
    throw new Error(
      `Local replica-set mongod did not become reachable on port ${LOCAL_REPLICA_PORT}.`
    );
  }

  const initResult = await ensureReplicaInitiated();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const hello = await getReplicaHello().catch(() => null);
    if (hello?.setName === LOCAL_REPLICA_SET_NAME) {
      return {
        managed: true,
        started: !alreadyRunning,
        initResult,
        uri: buildReplicaUri(),
      };
    }
    await wait(500);
  }

  throw new Error("Local replica-set mongod is online, but replica-set initialization did not settle.");
}

async function stopLocalReplicaSet() {
  if (!localReplicaChild || localReplicaChild.killed) {
    return;
  }

  const child = localReplicaChild;

  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    try {
      child.kill("SIGINT");
    } catch {
      clearTimeout(timeout);
      resolve();
    }
  });
}

module.exports = {
  LOCAL_REPLICA_SET_NAME,
  LOCAL_REPLICA_HOST,
  LOCAL_REPLICA_PORT,
  LOCAL_REPLICA_DB,
  LOCAL_MONGOD_PATH,
  REPLICA_ROOT,
  REPLICA_DATA_DIR,
  REPLICA_LOG_PATH,
  REPLICA_PID_PATH,
  buildReplicaUri,
  shouldManageLocalReplica,
  ensureLocalReplicaSet,
  stopLocalReplicaSet,
};
