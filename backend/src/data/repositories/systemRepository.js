const { mongoose } = require("../../config/db");
const models = require("../models");
const customerRepository = require("./customerRepository");
const productRepository = require("./productRepository");
const salesRepository = require("./salesRepository");
const settingsRepository = require("./settingsRepository");
const supplierRepository = require("./supplierRepository");
const userRepository = require("./userRepository");
const { cloneValue, toIsoTimestamp, toNullableIsoTimestamp } = require("./mongoRepositoryUtils");

function normalizeRole(row) {
  if (!row) return null;

  return {
    id: Number(row.id || 0),
    code: String(row.code || "").trim(),
    name: String(row.name || "").trim(),
    description: String(row.description || "").trim(),
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
  };
}

function normalizeInventoryMovement(row) {
  if (!row) return null;

  return {
    id: Number(row.id || 0),
    productId: Number(row.productId || 0),
    productName: String(row.productName || "").trim(),
    sku: String(row.sku || "").trim(),
    movementType: String(row.movementType || "adjustment").trim() || "adjustment",
    quantityDelta: Number(row.quantityDelta || 0),
    quantityBefore:
      row.quantityBefore === null || row.quantityBefore === undefined ? null : Number(row.quantityBefore),
    quantityAfter:
      row.quantityAfter === null || row.quantityAfter === undefined ? null : Number(row.quantityAfter),
    referenceType: String(row.referenceType || "").trim(),
    referenceId: String(row.referenceId || "").trim(),
    note: String(row.note || "").trim(),
    actorName: String(row.actorName || "").trim(),
    createdAt: toIsoTimestamp(row.createdAt),
  };
}

function normalizePurchaseOrder(row) {
  if (!row) return null;

  const items = Array.isArray(row.items) ? row.items : [];
  const linesCount = items.length;
  const unitsOrdered = items.reduce((sum, item) => sum + Number(item.qtyOrdered || 0), 0);
  const unitsReceived = items.reduce((sum, item) => sum + Number(item.qtyReceived || 0), 0);
  const openUnits = Math.max(0, unitsOrdered - unitsReceived);
  const receivedPercent = unitsOrdered > 0 ? Math.round((unitsReceived / unitsOrdered) * 100) : 0;

  return {
    id: String(row.id || "").trim(),
    supplierId: row.supplierId === null || row.supplierId === undefined ? null : Number(row.supplierId),
    supplier: String(row.supplier || "General Supplier").trim() || "General Supplier",
    status: String(row.status || "Draft").trim() || "Draft",
    note: String(row.note || "").trim(),
    createdBy: String(row.createdBy || "").trim(),
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
    expectedDate: toNullableIsoTimestamp(row.expectedDate),
    sentAt: toNullableIsoTimestamp(row.sentAt),
    receivedAt: toNullableIsoTimestamp(row.receivedAt),
    totalEstimatedCost: Number(row.totalEstimatedCost || 0),
    linesCount,
    unitsOrdered,
    unitsReceived,
    openUnits,
    receivedPercent,
    items: items.map((item) => ({
      id: Number(item.id || 0),
      productId: Number(item.productId || 0),
      productName: String(item.productName || "").trim(),
      sku: String(item.sku || "").trim(),
      qtyOrdered: Number(item.qtyOrdered || 0),
      qtyReceived: Number(item.qtyReceived || 0),
      unitCost: Number(item.unitCost || 0),
      status: String(item.status || "Open").trim() || "Open",
      createdAt: toIsoTimestamp(item.createdAt),
      updatedAt: toIsoTimestamp(item.updatedAt, item.createdAt),
    })),
  };
}

function normalizeCycleCount(row) {
  if (!row) return null;

  const items = Array.isArray(row.items) ? row.items : [];
  const linesCount = items.length;
  const varianceLines = items.filter((item) => Number(item.varianceQty || 0) !== 0).length;
  const varianceUnits = items.reduce((sum, item) => sum + Math.abs(Number(item.varianceQty || 0)), 0);

  return {
    id: String(row.id || "").trim(),
    status: String(row.status || "Open").trim() || "Open",
    note: String(row.note || "").trim(),
    createdBy: String(row.createdBy || "").trim(),
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
    completedAt: toNullableIsoTimestamp(row.completedAt),
    linesCount,
    varianceLines,
    varianceUnits,
    items: items.map((item) => ({
      id: Number(item.id || 0),
      productId: Number(item.productId || 0),
      productName: String(item.productName || "").trim(),
      sku: String(item.sku || "").trim(),
      expectedQty: Number(item.expectedQty || 0),
      countedQty:
        item.countedQty === null || item.countedQty === undefined ? null : Number(item.countedQty),
      varianceQty:
        item.varianceQty === null || item.varianceQty === undefined ? null : Number(item.varianceQty),
      status: String(item.status || "Pending").trim() || "Pending",
      createdAt: toIsoTimestamp(item.createdAt),
      updatedAt: toIsoTimestamp(item.updatedAt, item.createdAt),
    })),
  };
}

function normalizeAccessEvent(row) {
  if (!row) return null;

  return {
    id: Number(row.id || 0),
    userId: row.userId === null || row.userId === undefined ? null : Number(row.userId),
    staffId: String(row.staffId || "").trim(),
    fullName: String(row.fullName || "").trim(),
    eventType: String(row.eventType || "").trim(),
    title: String(row.title || "").trim(),
    message: String(row.message || "").trim(),
    actorName: String(row.actorName || "").trim(),
    createdAt: toIsoTimestamp(row.createdAt),
  };
}

function normalizeSavedView(row) {
  if (!row) return null;

  return {
    id: Number(row.id || 0),
    ownerUserId: Number(row.ownerUserId || 0),
    pageKey: String(row.pageKey || "").trim(),
    name: String(row.name || "").trim(),
    config: row.config && typeof row.config === "object" ? cloneValue(row.config) : {},
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
  };
}

function normalizeAuditLog(row) {
  if (!row) return null;

  return {
    id: Number(row.id || 0),
    action: String(row.action || "").trim(),
    entityType: String(row.entityType || "").trim(),
    entityId: String(row.entityId || "").trim(),
    actorUserId:
      row.actorUserId === null || row.actorUserId === undefined ? null : Number(row.actorUserId),
    actorStaffId: String(row.actorStaffId || "").trim(),
    actorName: String(row.actorName || "").trim(),
    details: row.details && typeof row.details === "object" ? cloneValue(row.details) : {},
    createdAt: toIsoTimestamp(row.createdAt),
  };
}

async function getStorageInfo() {
  const [
    roles,
    suppliers,
    customers,
    products,
    users,
    sales,
    purchaseOrders,
    inventoryMovements,
    cycleCounts,
    userAccessEvents,
    userSavedViews,
    settingsProfiles,
    auditLogs,
  ] = await Promise.all([
    models.Role.countDocuments({}),
    models.Supplier.countDocuments({}),
    models.Customer.countDocuments({}),
    models.Product.countDocuments({}),
    models.User.countDocuments({}),
    models.Sale.countDocuments({}),
    models.PurchaseOrder.countDocuments({}),
    models.InventoryMovement.countDocuments({}),
    models.CycleCount.countDocuments({}),
    models.UserAccessEvent.countDocuments({}),
    models.UserSavedView.countDocuments({}),
    models.AppSetting.countDocuments({}),
    models.AuditLog.countDocuments({}),
  ]);

  return {
    engine: "mongo",
    databaseFile: null,
    counts: {
      roles,
      suppliers,
      customers,
      products,
      users,
      sales,
      purchaseOrders,
      inventoryMovements,
      cycleCounts,
      userAccessEvents,
      userSavedViews,
      settingsProfiles,
      auditLogs,
    },
  };
}

async function getMongoDeploymentInfo() {
  const fallback = {
    topology: "unknown",
    replicaSetName: null,
    isWritablePrimary: null,
    logicalSessionTimeoutMinutes: null,
    hosts: [],
    transactions: {
      nativeSupported: false,
      fallbackEnabled: false,
      effectiveMode: "unknown",
    },
  };

  try {
    if (!mongoose.connection?.db) {
      return fallback;
    }

    const admin = mongoose.connection.db.admin();
    const hello =
      (await admin.command({ hello: 1 }).catch(() => null)) ||
      (await admin.command({ isMaster: 1 }).catch(() => null)) ||
      {};
    const isShardedCluster = String(hello.msg || "").toLowerCase() === "isdbgrid";
    const isReplicaSet = Boolean(hello.setName);
    const nativeSupported = isShardedCluster || isReplicaSet;

    return {
      topology: isShardedCluster ? "sharded" : isReplicaSet ? "replica-set" : "standalone",
      replicaSetName: hello.setName || null,
      isWritablePrimary: hello.isWritablePrimary ?? hello.ismaster ?? null,
      logicalSessionTimeoutMinutes:
        hello.logicalSessionTimeoutMinutes === undefined
          ? null
          : Number(hello.logicalSessionTimeoutMinutes),
      hosts: Array.isArray(hello.hosts) ? hello.hosts : [],
      transactions: {
        nativeSupported,
        fallbackEnabled: false,
        effectiveMode: nativeSupported ? "native" : "unavailable",
      },
    };
  } catch {
    return fallback;
  }
}

async function getBackupSnapshot() {
  const [
    storage,
    settings,
    roles,
    suppliers,
    customers,
    products,
    users,
    sales,
    purchaseOrders,
    inventoryMovements,
    cycleCounts,
    userAccessEvents,
    userSavedViews,
    auditLogs,
  ] = await Promise.all([
    getStorageInfo(),
    settingsRepository.getAppSettings(),
    models.Role.find({}).sort({ id: 1 }).lean().then((rows) => rows.map(normalizeRole)),
    supplierRepository.getSuppliers(),
    customerRepository.getCustomers(),
    productRepository.getProducts(),
    userRepository.getUsers(),
    salesRepository.getSales(),
    models.PurchaseOrder.find({}).sort({ createdAt: -1, id: -1 }).lean().then((rows) => rows.map(normalizePurchaseOrder)),
    models.InventoryMovement.find({}).sort({ createdAt: -1, id: -1 }).lean().then((rows) => rows.map(normalizeInventoryMovement)),
    models.CycleCount.find({}).sort({ createdAt: -1, id: -1 }).lean().then((rows) => rows.map(normalizeCycleCount)),
    models.UserAccessEvent.find({}).sort({ createdAt: -1, id: -1 }).lean().then((rows) => rows.map(normalizeAccessEvent)),
    models.UserSavedView.find({}).sort({ updatedAt: -1, name: 1 }).lean().then((rows) => rows.map(normalizeSavedView)),
    models.AuditLog.find({}).sort({ createdAt: -1, id: -1 }).lean().then((rows) => rows.map(normalizeAuditLog)),
  ]);

  return {
    formatVersion: 2,
    generatedAt: new Date().toISOString(),
    storage,
    settings,
    roles,
    suppliers,
    customers,
    products,
    users,
    sales,
    purchaseOrders,
    inventoryMovements,
    cycleCounts,
    userAccessEvents,
    userSavedViews,
    auditLogs,
  };
}

module.exports = {
  getBackupSnapshot,
  getMongoDeploymentInfo,
  getStorageInfo,
};
