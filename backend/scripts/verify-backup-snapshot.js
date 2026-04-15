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

function isValidIsoDate(value) {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

async function run() {
  runtime.assertRuntimeConfig();
  await connectDB();

  const snapshot = await systemService.getBackupSnapshot();
  const counts = snapshot?.storage?.counts || {};
  const collectionKeys = [
    ["roles", "roles"],
    ["suppliers", "suppliers"],
    ["customers", "customers"],
    ["products", "products"],
    ["users", "users"],
    ["sales", "sales"],
    ["purchaseOrders", "purchaseOrders"],
    ["inventoryMovements", "inventoryMovements"],
    ["cycleCounts", "cycleCounts"],
    ["userAccessEvents", "userAccessEvents"],
    ["userSavedViews", "userSavedViews"],
    ["auditLogs", "auditLogs"],
  ];

  const failures = [];

  if (Number(snapshot?.formatVersion || 0) < 2) {
    failures.push("formatVersion is missing or older than the required backup schema.");
  }

  if (!isValidIsoDate(snapshot?.generatedAt)) {
    failures.push("generatedAt is missing or invalid.");
  }

  if (!snapshot?.settings || typeof snapshot.settings !== "object") {
    failures.push("settings payload is missing.");
  }

  for (const [field, countKey] of collectionKeys) {
    const value = snapshot?.[field];
    if (!Array.isArray(value)) {
      failures.push(`${field} is not an array.`);
      continue;
    }

    const expectedCount = Number(counts[countKey] || 0);
    if (value.length !== expectedCount) {
      failures.push(
        `${field} length (${value.length}) does not match storage count (${expectedCount}).`
      );
    }
  }

  printSection("Backup Snapshot");
  printKeyValue("formatVersion", snapshot?.formatVersion || "n/a");
  printKeyValue("generatedAt", snapshot?.generatedAt || "n/a");
  printKeyValue("settingsPresent", snapshot?.settings ? "yes" : "no");

  printSection("Collection Counts");
  for (const [field, countKey] of collectionKeys) {
    const value = Array.isArray(snapshot?.[field]) ? snapshot[field].length : "invalid";
    printKeyValue(field, `${value} (storage: ${Number(counts[countKey] || 0)})`);
  }

  printSection("Result");
  if (failures.length > 0) {
    failures.forEach((failure) => console.log(`FAIL: ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log("PASS: Backup snapshot is structurally valid and matches live storage counts.");
}

run()
  .catch((error) => {
    console.error("Backup verification failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB().catch(() => {});
  });
