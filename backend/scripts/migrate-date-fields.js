require("../src/config/loadEnv");

const { connectDB, disconnectDB } = require("../src/config/db");
const models = require("../src/data/models");

const MIGRATIONS = [
  {
    name: "appSettings",
    model: models.AppSetting,
    fields: ["updatedAt"],
  },
  {
    name: "auditLogs",
    model: models.AuditLog,
    fields: ["createdAt"],
  },
  {
    name: "counters",
    model: models.Counter,
    fields: ["createdAt", "updatedAt"],
  },
  {
    name: "customers",
    model: models.Customer,
    fields: ["createdAt", "updatedAt"],
  },
  {
    name: "cycleCounts",
    model: models.CycleCount,
    fields: ["createdAt", "updatedAt", "completedAt"],
    arrayFields: [{ path: "items", fields: ["createdAt", "updatedAt"] }],
  },
  {
    name: "inventoryMovements",
    model: models.InventoryMovement,
    fields: ["createdAt"],
  },
  {
    name: "products",
    model: models.Product,
    fields: ["createdAt", "updatedAt"],
  },
  {
    name: "purchaseOrders",
    model: models.PurchaseOrder,
    fields: ["createdAt", "updatedAt", "expectedDate", "sentAt", "receivedAt"],
    arrayFields: [{ path: "items", fields: ["createdAt", "updatedAt"] }],
  },
  {
    name: "roles",
    model: models.Role,
    fields: ["createdAt", "updatedAt"],
  },
  {
    name: "sales",
    model: models.Sale,
    fields: ["date", "createdAt", "updatedAt"],
    arrayFields: [{ path: "items", fields: ["createdAt", "updatedAt"] }],
  },
  {
    name: "suppliers",
    model: models.Supplier,
    fields: ["createdAt", "updatedAt"],
  },
  {
    name: "users",
    model: models.User,
    fields: ["invitedAt", "approvedAt", "pinUpdatedAt", "createdAt", "updatedAt"],
  },
  {
    name: "userAccessEvents",
    model: models.UserAccessEvent,
    fields: ["createdAt"],
  },
  {
    name: "userSavedViews",
    model: models.UserSavedView,
    fields: ["createdAt", "updatedAt"],
  },
  {
    name: "userSessions",
    model: models.UserSession,
    fields: ["loginAt", "lastSeenAt", "logoutAt"],
  },
];

function tryParseDate(value) {
  if (value === null || value === undefined || value === "") {
    return { changed: false, value };
  }

  if (value instanceof Date) {
    return { changed: false, value };
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      return { changed: true, value: parsed };
    }
  }

  return { changed: false, value };
}

function transformArrayItems(items, fields, warnings, collectionName, documentId) {
  if (!Array.isArray(items)) {
    return { changed: false, value: items };
  }

  let changed = false;
  const nextItems = items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return item;
    }

    let itemChanged = false;
    const nextItem = { ...item };

    fields.forEach((field) => {
      if (!(field in item)) {
        return;
      }

      const result = tryParseDate(item[field]);
      if (result.changed) {
        nextItem[field] = result.value;
        itemChanged = true;
        return;
      }

      if (
        item[field] !== null &&
        item[field] !== undefined &&
        !(item[field] instanceof Date)
      ) {
        warnings.push(
          `${collectionName}/${String(documentId)}:${field}[${index}] could not be converted`
        );
      }
    });

    if (itemChanged) {
      changed = true;
    }

    return nextItem;
  });

  return {
    changed,
    value: nextItems,
  };
}

function buildUpdate(document, migration, warnings) {
  const nextSet = {};
  let changed = false;

  for (const field of migration.fields || []) {
    if (!(field in document)) {
      continue;
    }

    const result = tryParseDate(document[field]);
    if (result.changed) {
      nextSet[field] = result.value;
      changed = true;
      continue;
    }

    if (
      document[field] !== null &&
      document[field] !== undefined &&
      !(document[field] instanceof Date)
    ) {
      warnings.push(`${migration.name}/${String(document.id || document._id)}:${field} could not be converted`);
    }
  }

  for (const arrayField of migration.arrayFields || []) {
    if (!(arrayField.path in document)) {
      continue;
    }

    const transformed = transformArrayItems(
      document[arrayField.path],
      arrayField.fields,
      warnings,
      migration.name,
      document.id || document._id
    );

    if (transformed.changed) {
      nextSet[arrayField.path] = transformed.value;
      changed = true;
    }
  }

  return changed ? nextSet : null;
}

async function migrateCollection(migration) {
  const collection = migration.model.collection;
  const cursor = collection.find({});
  const bulkOperations = [];
  const warnings = [];
  let inspected = 0;
  let updated = 0;

  while (await cursor.hasNext()) {
    const document = await cursor.next();
    inspected += 1;

    const nextSet = buildUpdate(document, migration, warnings);
    if (!nextSet) {
      continue;
    }

    bulkOperations.push({
      updateOne: {
        filter: { _id: document._id },
        update: { $set: nextSet },
      },
    });

    if (bulkOperations.length >= 200) {
      const result = await collection.bulkWrite(bulkOperations, { ordered: false });
      updated += Number(result.modifiedCount || 0);
      bulkOperations.length = 0;
    }
  }

  if (bulkOperations.length > 0) {
    const result = await collection.bulkWrite(bulkOperations, { ordered: false });
    updated += Number(result.modifiedCount || 0);
  }

  return {
    collection: migration.name,
    inspected,
    updated,
    warnings,
  };
}

async function main() {
  await connectDB();

  const results = [];
  for (const migration of MIGRATIONS) {
    results.push(await migrateCollection(migration));
  }

  const summary = {
    collections: results.map((result) => ({
      collection: result.collection,
      inspected: result.inspected,
      updated: result.updated,
      warnings: result.warnings.length,
    })),
    warnings: results.flatMap((result) => result.warnings),
  };

  console.log("Mongo date-field migration complete.");
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error("Mongo date-field migration failed:", error);
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
