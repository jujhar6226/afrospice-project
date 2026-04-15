require("../src/config/loadEnv");

const runtime = require("../src/config/runtime");
const { connectDB, disconnectDB, mongoose } = require("../src/config/db");
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
  const aiStatus = systemService.getAiStatus();
  const counts = details?.storage?.counts || {};
  const transactions = details?.mongo?.transactions || {};
  const requiredCountKeys = [
    "roles",
    "users",
    "products",
    "customers",
    "suppliers",
  ];
  const zeroCountKeys = requiredCountKeys.filter((key) => Number(counts[key] || 0) === 0);

  printSection("Mongo Runtime");
  printKeyValue("MONGO_URI", runtime.mongoUri);
  printKeyValue("connected", mongoose.connection.readyState === 1 ? "yes" : "no");
  printKeyValue("host", details?.mongo?.host || "n/a");
  printKeyValue("port", details?.mongo?.port || "n/a");
  printKeyValue("database", details?.mongo?.database || "n/a");
  printKeyValue("state", details?.mongo?.state || "unknown");
  printKeyValue("topology", details?.mongo?.topology || "unknown");
  printKeyValue("replicaSetName", details?.mongo?.replicaSetName || "none");

  printSection("Transaction Runtime");
  printKeyValue("nativeSupported", transactions.nativeSupported ? "yes" : "no");
  printKeyValue("fallbackEnabled", transactions.fallbackEnabled ? "yes" : "no");
  printKeyValue("effectiveMode", transactions.effectiveMode || "unknown");

  printSection("Storage Counts");
  Object.entries(counts).forEach(([key, value]) => {
    printKeyValue(key, value);
  });

  printSection("AI Runtime");
  printKeyValue("mode", aiStatus?.mode || "unknown");
  printKeyValue("provider", aiStatus?.provider || "none");
  printKeyValue("configured", aiStatus?.configured ? "yes" : "no");
  printKeyValue("message", aiStatus?.message || "n/a");

  printSection("Verification");
  if (zeroCountKeys.length === 0) {
    console.log("PASS: MongoDB is connected and core business collections contain live records.");
  } else {
    console.log(
      `WARN: MongoDB is connected, but these core collections currently have 0 records: ${zeroCountKeys.join(", ")}`
    );
    process.exitCode = 2;
  }

  if (!transactions.nativeSupported) {
    console.log(
      "WARN: MongoDB is not currently running with native transaction support. Enable a replica set for production-grade local integrity."
    );
  }
}

run()
  .catch((error) => {
    console.error("Verification failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB().catch(() => {});
  });
