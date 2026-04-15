require("../src/config/loadEnv");

const runtime = require("../src/config/runtime");
const { connectDB, disconnectDB } = require("../src/config/db");
const storeRuntime = require("../src/data/storeRuntime");

async function main() {
  runtime.assertRuntimeConfig();
  await connectDB();
  await storeRuntime.initialize();

  const result = await storeRuntime.bootstrapSeedData({
    onlyIfEmpty: false,
  });

  await storeRuntime.refreshCache();
  const storage = storeRuntime.getStorageInfo();

  console.log("Mongo bootstrap/import complete.");
  console.log(
    JSON.stringify(
      {
        result,
        mongoUri: runtime.mongoUri,
        counts: storage.counts,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("Mongo bootstrap/import failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await disconnectDB();
    } catch (error) {
      console.error("Mongo disconnect failed:", error);
      process.exitCode = 1;
    }
  });
