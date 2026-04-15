require("../src/config/loadEnv");

const runtime = require("../src/config/runtime");
const { connectDB, disconnectDB } = require("../src/config/db");
const systemService = require("../src/services/systemService");

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function printKeyValue(key, value) {
  console.log(`${key}: ${value}`);
}

async function run() {
  runtime.assertRuntimeConfig();
  await connectDB();

  const details = await systemService.getHealthDetails();
  const mongo = details.mongo || {};
  const transactions = mongo.transactions || {};
  const nativeSupported = Boolean(transactions.nativeSupported);
  const fallbackEnabled = Boolean(transactions.fallbackEnabled);

  printSection("Mongo Deployment");
  printKeyValue("uri", runtime.mongoUri);
  printKeyValue("topology", mongo.topology || "unknown");
  printKeyValue("replicaSetName", mongo.replicaSetName || "none");
  printKeyValue("state", mongo.state || "unknown");
  printKeyValue("host", mongo.host || "n/a");
  printKeyValue("port", mongo.port || "n/a");
  printKeyValue("logicalSessionTimeoutMinutes", mongo.logicalSessionTimeoutMinutes ?? "n/a");

  printSection("Transaction Readiness");
  printKeyValue("nativeSupported", nativeSupported ? "yes" : "no");
  printKeyValue("fallbackEnabled", fallbackEnabled ? "yes" : "no");
  printKeyValue("effectiveMode", transactions.effectiveMode || "unknown");

  printSection("Result");
  if (nativeSupported) {
    console.log("PASS: MongoDB is running with native transaction support.");
    return;
  }

  if (fallbackEnabled) {
    console.log(
      "WARN: MongoDB is connected, but this deployment is not a replica set. The app is using development transaction fallback."
    );
    process.exitCode = 2;
    return;
  }

  console.log(
    "FAIL: MongoDB is connected without native transaction support and no fallback mode is allowed."
  );
  process.exitCode = 1;
}

run()
  .catch((error) => {
    console.error("Transaction readiness verification failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB().catch(() => {});
  });
