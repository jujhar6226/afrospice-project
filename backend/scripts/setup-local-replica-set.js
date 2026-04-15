require("../src/config/loadEnv");

const runtime = require("../src/config/runtime");
const { MongoClient } = require("mongoose").mongo;
const {
  LOCAL_REPLICA_DB,
  LOCAL_REPLICA_HOST,
  LOCAL_REPLICA_PORT,
  LOCAL_REPLICA_SET_NAME,
  buildReplicaUri,
  ensureLocalReplicaSet,
} = require("../src/config/localReplicaSet");

function sourceUri() {
  return (
    process.env.SOURCE_MONGO_URI ||
    "mongodb://127.0.0.1:27017/afrospice"
  );
}

async function withClient(uri, fn) {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
  });

  await client.connect();

  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function countUserCollections(database) {
  const collections = await database.listCollections({}, { nameOnly: true }).toArray();
  return collections.filter((entry) => !String(entry.name || "").startsWith("system.")).length;
}

async function copyCollections() {
  const source = sourceUri();
  const target = buildReplicaUri(LOCAL_REPLICA_DB);

  return withClient(source, async (sourceClient) => {
    return withClient(target, async (targetClient) => {
      const sourceDb = sourceClient.db(LOCAL_REPLICA_DB);
      const targetDb = targetClient.db(LOCAL_REPLICA_DB);

      const sourceCollections = await sourceDb.listCollections({}, { nameOnly: true }).toArray();
      const targetCollectionCount = await countUserCollections(targetDb);

      if (targetCollectionCount > 0 && String(process.env.FORCE_REPLICA_SYNC || "").toLowerCase() !== "true") {
        return {
          copied: false,
          reason: "target-not-empty",
          source,
          target,
        };
      }

      const collectionNames = sourceCollections
        .map((entry) => String(entry.name || "").trim())
        .filter((name) => name && !name.startsWith("system."));

      const result = {
        copied: true,
        source,
        target,
        collections: [],
      };

      for (const name of collectionNames) {
        const sourceDocs = await sourceDb.collection(name).find({}).toArray();
        await targetDb.collection(name).deleteMany({});
        if (sourceDocs.length > 0) {
          await targetDb.collection(name).insertMany(sourceDocs, { ordered: false });
        }
        result.collections.push({
          name,
          documents: sourceDocs.length,
        });
      }

      return result;
    });
  });
}

async function main() {
  const originalUri = runtime.mongoUri;
  process.env.MONGO_URI = buildReplicaUri(LOCAL_REPLICA_DB);

  const replica = await ensureLocalReplicaSet();
  const syncResult = await copyCollections();

  console.log("Local Mongo replica-set setup complete.");
  console.log(
    JSON.stringify(
      {
        managedReplica: replica,
        syncResult,
        recommendedMongoUri: buildReplicaUri(LOCAL_REPLICA_DB),
        sourceMongoUri: sourceUri(),
        originalRuntimeMongoUri: originalUri,
        localReplicaHost: LOCAL_REPLICA_HOST,
        localReplicaPort: LOCAL_REPLICA_PORT,
        replicaSetName: LOCAL_REPLICA_SET_NAME,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Local Mongo replica-set setup failed:", error);
  process.exitCode = 1;
});
