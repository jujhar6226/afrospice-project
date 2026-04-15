require("../src/config/loadEnv");

const runtime = require("../src/config/runtime");
const { connectDB, disconnectDB, mongoose } = require("../src/config/db");
const systemService = require("../src/services/systemService");
const baseModels = require("../src/data/models");

const COUNTER_KEYS = {
  role: "role_id",
  supplier: "supplier_id",
  customer: "customer_id",
  product: "product_id",
  user: "user_id",
  sale: "sale_id",
  inventoryMovement: "inventory_movement_id",
  purchaseOrder: "purchase_order_id",
  cycleCount: "cycle_count_id",
  userAccessEvent: "user_access_event_id",
  userSavedView: "user_saved_view_id",
  auditLog: "audit_log_id",
};

const MODEL_ORDER = [
  "Role",
  "Supplier",
  "Customer",
  "Product",
  "User",
  "Sale",
  "InventoryMovement",
  "PurchaseOrder",
  "CycleCount",
  "AppSetting",
  "UserAccessEvent",
  "UserSavedView",
  "AuditLog",
  "Counter",
];

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function printKeyValue(key, value) {
  console.log(`${key}: ${value}`);
}

function buildTempDatabaseName() {
  const baseName = mongoose.connection.name || "afrospice";
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${baseName}_restore_verify_${suffix}`;
}

function buildMongoUriWithDatabase(uri, databaseName) {
  const parsed = new URL(uri);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function createTempModels(connection) {
  return MODEL_ORDER.reduce((models, modelName) => {
    const sourceModel = baseModels[modelName];
    models[modelName] = connection.model(
      modelName,
      sourceModel.schema.clone(),
      sourceModel.collection.collectionName
    );
    return models;
  }, {});
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function maxNumeric(values, field = "id", fallback = 0) {
  if (!Array.isArray(values) || values.length === 0) {
    return fallback;
  }

  return Math.max(
    fallback,
    ...values.map((value) => Number(value?.[field] || 0)).filter((value) => Number.isFinite(value))
  );
}

function maxParsedId(values, fallback = 0) {
  if (!Array.isArray(values) || values.length === 0) {
    return fallback;
  }

  return Math.max(
    fallback,
    ...values
      .map((value) => Number(String(value?.id || "").replace(/[^\d]/g, "")))
      .filter((value) => Number.isFinite(value))
  );
}

function normalizeUsers(users = []) {
  return asArray(users).map((user) => {
    const nextUser = { ...user };
    nextUser.pinHash = String(user?.pin || user?.pinHash || "");
    delete nextUser.pin;
    return nextUser;
  });
}

function buildCounterDocuments(snapshot, timestamp) {
  return [
    { key: COUNTER_KEYS.role, seq: maxNumeric(snapshot.roles, "id", 0), createdAt: timestamp, updatedAt: timestamp },
    {
      key: COUNTER_KEYS.supplier,
      seq: maxNumeric(snapshot.suppliers, "id", 0),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      key: COUNTER_KEYS.customer,
      seq: maxNumeric(snapshot.customers, "id", 0),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      key: COUNTER_KEYS.product,
      seq: maxNumeric(snapshot.products, "id", 0),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    { key: COUNTER_KEYS.user, seq: maxNumeric(snapshot.users, "id", 0), createdAt: timestamp, updatedAt: timestamp },
    {
      key: COUNTER_KEYS.sale,
      seq: maxParsedId(snapshot.sales, 1000),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      key: COUNTER_KEYS.inventoryMovement,
      seq: maxNumeric(snapshot.inventoryMovements, "id", 0),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      key: COUNTER_KEYS.purchaseOrder,
      seq: maxParsedId(snapshot.purchaseOrders, 1000),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      key: COUNTER_KEYS.cycleCount,
      seq: maxParsedId(snapshot.cycleCounts, 1000),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      key: COUNTER_KEYS.userAccessEvent,
      seq: maxNumeric(snapshot.userAccessEvents, "id", 0),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      key: COUNTER_KEYS.userSavedView,
      seq: maxNumeric(snapshot.userSavedViews, "id", 0),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      key: COUNTER_KEYS.auditLog,
      seq: maxNumeric(snapshot.auditLogs, "id", 0),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}

function buildRestorePayload(snapshot) {
  const generatedAt = snapshot?.generatedAt || new Date().toISOString();

  return {
    Role: asArray(snapshot.roles),
    Supplier: asArray(snapshot.suppliers),
    Customer: asArray(snapshot.customers),
    Product: asArray(snapshot.products),
    User: normalizeUsers(snapshot.users),
    Sale: asArray(snapshot.sales),
    InventoryMovement: asArray(snapshot.inventoryMovements),
    PurchaseOrder: asArray(snapshot.purchaseOrders),
    CycleCount: asArray(snapshot.cycleCounts),
    AppSetting: snapshot?.settings ? [{ ...snapshot.settings, id: Number(snapshot.settings.id || 1) }] : [],
    UserAccessEvent: asArray(snapshot.userAccessEvents),
    UserSavedView: asArray(snapshot.userSavedViews),
    AuditLog: asArray(snapshot.auditLogs),
    Counter: buildCounterDocuments(snapshot, generatedAt),
  };
}

async function insertRestorePayload(models, payload) {
  for (const modelName of MODEL_ORDER) {
    const documents = asArray(payload[modelName]);
    if (!documents.length) {
      continue;
    }

    await models[modelName].insertMany(documents, { ordered: true });
  }
}

async function verifyRestoreCounts(models, snapshot) {
  const expectations = [
    ["Role", asArray(snapshot.roles).length],
    ["Supplier", asArray(snapshot.suppliers).length],
    ["Customer", asArray(snapshot.customers).length],
    ["Product", asArray(snapshot.products).length],
    ["User", asArray(snapshot.users).length],
    ["Sale", asArray(snapshot.sales).length],
    ["InventoryMovement", asArray(snapshot.inventoryMovements).length],
    ["PurchaseOrder", asArray(snapshot.purchaseOrders).length],
    ["CycleCount", asArray(snapshot.cycleCounts).length],
    ["AppSetting", snapshot?.settings ? 1 : 0],
    ["UserAccessEvent", asArray(snapshot.userAccessEvents).length],
    ["UserSavedView", asArray(snapshot.userSavedViews).length],
    ["AuditLog", asArray(snapshot.auditLogs).length],
    ["Counter", 12],
  ];

  const failures = [];
  const summary = [];

  for (const [modelName, expectedCount] of expectations) {
    const actualCount = await models[modelName].countDocuments({});
    summary.push({ modelName, actualCount, expectedCount });

    if (actualCount !== expectedCount) {
      failures.push(`${modelName} count mismatch: expected ${expectedCount}, got ${actualCount}.`);
    }
  }

  const restoredUserWithPin = await models.User.countDocuments({
    pinHash: { $exists: true, $ne: "" },
  });
  const snapshotUsersWithPin = normalizeUsers(snapshot.users).filter((user) => String(user.pinHash || "").trim()).length;

  if (restoredUserWithPin !== snapshotUsersWithPin) {
    failures.push(
      `User pinHash coverage mismatch: expected ${snapshotUsersWithPin}, got ${restoredUserWithPin}.`
    );
  }

  return { failures, summary, restoredUserWithPin, snapshotUsersWithPin };
}

async function run() {
  runtime.assertRuntimeConfig();
  await connectDB();

  const snapshot = await systemService.getBackupSnapshot();
  const tempDatabaseName = buildTempDatabaseName();
  const tempMongoUri = buildMongoUriWithDatabase(runtime.mongoUri, tempDatabaseName);

  printSection("Restore Drill");
  printKeyValue("sourceDatabase", mongoose.connection.name || "unknown");
  printKeyValue("tempDatabase", tempDatabaseName);

  const tempConnection = await mongoose.createConnection(tempMongoUri, {
    appName: "afrospice-restore-verify",
    maxPoolSize: 5,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 30000,
    retryWrites: true,
    autoIndex: false,
  }).asPromise();

  try {
    const tempModels = createTempModels(tempConnection);
    await tempConnection.dropDatabase();

    const payload = buildRestorePayload(snapshot);
    await insertRestorePayload(tempModels, payload);
    const verification = await verifyRestoreCounts(tempModels, snapshot);

    printSection("Restored Counts");
    verification.summary.forEach((entry) => {
      printKeyValue(entry.modelName, `${entry.actualCount} (expected: ${entry.expectedCount})`);
    });
    printKeyValue(
      "User pinHash coverage",
      `${verification.restoredUserWithPin} (expected: ${verification.snapshotUsersWithPin})`
    );

    printSection("Result");
    if (verification.failures.length > 0) {
      verification.failures.forEach((failure) => console.log(`FAIL: ${failure}`));
      process.exitCode = 1;
      return;
    }

    console.log("PASS: Backup snapshot restored cleanly into a temporary database and matched expected counts.");
  } finally {
    await tempConnection.dropDatabase().catch(() => {});
    await tempConnection.close().catch(() => {});
  }
}

run()
  .catch((error) => {
    console.error("Backup restore verification failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB().catch(() => {});
  });
