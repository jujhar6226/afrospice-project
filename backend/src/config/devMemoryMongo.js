let replSet = null;

function isNodeDevelopment() {
  return String(process.env.NODE_ENV || "development").trim() !== "production";
}

async function maybeStartDevMemoryMongo() {
  if (!isNodeDevelopment()) {
    return;
  }

  const raw = String(process.env.MONGO_URI || "").trim();
  const useMemory = !raw || raw.toLowerCase() === "memory";
  if (!useMemory) {
    return;
  }

  if (replSet) {
    return;
  }

  const { MongoMemoryReplSet } = require("mongodb-memory-server");

  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
  });

  process.env.MONGO_URI = replSet.getUri("afrospice");
  console.log("Development: in-memory MongoDB replica set (no local mongod install).");
}

async function stopDevMemoryMongo() {
  if (!replSet) {
    return;
  }

  const rs = replSet;
  replSet = null;

  try {
    await rs.stop();
  } catch (error) {
    console.error("Stop in-memory MongoDB failed:", error);
  }
}

module.exports = {
  maybeStartDevMemoryMongo,
  stopDevMemoryMongo,
};
