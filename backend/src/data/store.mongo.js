const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { mongoose } = require("../config/db");
const runtime = require("../config/runtime");
const defaultSettings = require("./defaultSettings");
const seedData = require("./seedData");
const models = require("./models");
const {
  calculateTaxAmount,
  getProductTaxProfile,
  normalizeStoredTaxClass,
} = require("../tax/ontarioProductTax");

const TIMETABLE_DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const DEFAULT_TIMETABLE_WINDOWS = {
  Flexible: { start: "09:00", end: "17:00" },
  "Front Desk": { start: "09:00", end: "18:00" },
  Morning: { start: "08:00", end: "16:00" },
  Midday: { start: "10:00", end: "18:00" },
  Evening: { start: "12:00", end: "20:00" },
  Stockroom: { start: "07:00", end: "15:00" },
  Receiving: { start: "06:00", end: "14:00" },
  "On Call": { start: "09:00", end: "17:00" },
  Off: { start: "00:00", end: "00:00" },
};

const CANONICAL_ROLE_DEFINITIONS = [
  {
    code: "owner",
    name: "Owner",
    description: "Full business administration and security authority.",
  },
  {
    code: "manager",
    name: "Manager",
    description: "Operational oversight with refund and reporting authority.",
  },
  {
    code: "cashier",
    name: "Cashier",
    description: "Checkout and customer-facing transaction access.",
  },
  {
    code: "inventory_clerk",
    name: "Inventory Clerk",
    description: "Inventory receiving, stock control, and count management.",
  },
];

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

const cache = {
  roles: [],
  suppliers: [],
  customers: [],
  products: [],
  users: [],
  sales: [],
  inventoryMovements: [],
  purchaseOrders: [],
  cycleCounts: [],
  settings: {
    ...defaultSettings,
    updatedAt: new Date().toISOString(),
  },
  userAccessEvents: [],
  userSessions: [],
  userSavedViews: [],
  auditLogsCount: 0,
};

let initialized = false;
let initializePromise = null;
let refreshPromise = null;
let writeQueue = Promise.resolve();
let mongoDeploymentInfo = {
  topology: "unknown",
  replicaSetName: null,
  isWritablePrimary: null,
  logicalSessionTimeoutMinutes: null,
  hosts: [],
  transactions: {
    nativeSupported: false,
    fallbackEnabled: runtime.isDevelopment,
    effectiveMode: runtime.isDevelopment ? "development-fallback" : "unavailable",
  },
};

const TRANSACTION_OPTIONS = {
  readPreference: "primary",
};

function currentIsoTimestamp() {
  return new Date().toISOString();
}

function toIsoTimestamp(value, fallback = null) {
  const date = safeDate(value);
  if (date) {
    return date.toISOString();
  }

  if (fallback === null || fallback === undefined) {
    return currentIsoTimestamp();
  }

  const fallbackDate = safeDate(fallback);
  return fallbackDate ? fallbackDate.toISOString() : currentIsoTimestamp();
}

function toNullableIsoTimestamp(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const date = safeDate(value);
  if (date) {
    return date.toISOString();
  }

  return fallback;
}

function applySessionToQuery(query, session) {
  return session ? query.session(session) : query;
}

function supportsTransactionsInRuntime() {
  return mongoose.connection.readyState === 1;
}

function isTransactionUnsupportedError(error) {
  const message = String(error?.message || "");

  return (
    /Transaction numbers are only allowed on a replica set member or mongos/i.test(message) ||
    /replica set/i.test(message) ||
    /Transaction .* not supported/i.test(message)
  );
}

async function executeWriteWithOptionalTransaction(operation) {
  if (!supportsTransactionsInRuntime()) {
    return operation({ session: null });
  }

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      result = await operation({ session });
    }, TRANSACTION_OPTIONS);

    return result;
  } catch (error) {
    if (runtime.isDevelopment && isTransactionUnsupportedError(error)) {
      console.warn(
        "Mongo transactions are unavailable on the current development deployment. Continuing without a transaction."
      );
      return operation({ session: null });
    }

    throw error;
  } finally {
    await session.endSession();
  }
}

async function refreshMongoDeploymentInfo() {
  const fallback = {
    topology: "unknown",
    replicaSetName: null,
    isWritablePrimary: null,
    logicalSessionTimeoutMinutes: null,
    hosts: [],
    transactions: {
      nativeSupported: false,
      fallbackEnabled: runtime.isDevelopment,
      effectiveMode: runtime.isDevelopment ? "development-fallback" : "unavailable",
    },
  };

  try {
    if (!mongoose.connection?.db) {
      mongoDeploymentInfo = fallback;
      return mongoDeploymentInfo;
    }

    const admin = mongoose.connection.db.admin();
    const hello =
      (await admin.command({ hello: 1 }).catch(() => null)) ||
      (await admin.command({ isMaster: 1 }).catch(() => null)) ||
      {};
    const isShardedCluster = String(hello.msg || "").toLowerCase() === "isdbgrid";
    const isReplicaSet = Boolean(hello.setName);
    const nativeSupported = isShardedCluster || isReplicaSet;

    mongoDeploymentInfo = {
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
        fallbackEnabled: !nativeSupported && runtime.isDevelopment,
        effectiveMode: nativeSupported
          ? "native"
          : runtime.isDevelopment
            ? "development-fallback"
            : "unavailable",
      },
    };
  } catch {
    mongoDeploymentInfo = fallback;
  }

  return mongoDeploymentInfo;
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clone(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function compactLookupText(value, fallback = "") {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || String(fallback || "").trim();
}

function lookupKey(value) {
  return compactLookupText(value).toLowerCase();
}

function buildExactMatchRegex(value) {
  return new RegExp(`^${String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

function parseNumericFromId(value, fallback = 0) {
  const parsed = Number(String(value || "").replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isValidTimeValue(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "").trim());
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildDefaultTimetable(shiftAssignment = "Flexible") {
  const normalizedShift = String(shiftAssignment || "Flexible").trim() || "Flexible";
  const window =
    DEFAULT_TIMETABLE_WINDOWS[normalizedShift] || DEFAULT_TIMETABLE_WINDOWS.Flexible;
  const weekdayActive = normalizedShift !== "Off";

  return Object.fromEntries(
    TIMETABLE_DAY_KEYS.map((dayKey, index) => [
      dayKey,
      {
        active: weekdayActive && index < 5,
        shift: normalizedShift,
        start: window.start,
        end: window.end,
      },
    ])
  );
}

function normalizeStoredTimetable(raw, shiftAssignment = "Flexible") {
  const fallback = buildDefaultTimetable(shiftAssignment);
  let parsed = {};

  if (typeof raw === "string" && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  } else if (raw && typeof raw === "object") {
    parsed = raw;
  }

  return Object.fromEntries(
    TIMETABLE_DAY_KEYS.map((dayKey) => {
      const source = parsed?.[dayKey] || {};
      const fallbackDay = fallback[dayKey];
      const nextShift = String(source.shift || fallbackDay.shift || "Flexible").trim() || "Flexible";

      return [
        dayKey,
        {
          active: Boolean(source.active ?? fallbackDay.active),
          shift: nextShift,
          start: isValidTimeValue(source.start) ? String(source.start) : fallbackDay.start,
          end: isValidTimeValue(source.end) ? String(source.end) : fallbackDay.end,
        },
      ];
    })
  );
}

function getDefaultShiftAssignment(role = "") {
  const normalizedRole = String(role || "").trim();
  if (normalizedRole === "Owner" || normalizedRole === "Manager") return "Flexible";
  if (normalizedRole === "Cashier") return "Front Desk";
  if (normalizedRole === "Inventory Clerk") return "Stockroom";
  return "Unassigned";
}

function estimateUnitCost(price) {
  const normalizedPrice = Math.max(0, Number(price || 0));
  return Number((normalizedPrice * 0.62).toFixed(2));
}

async function ensureBootstrapSuppliers(now) {
  const byName = new Map(
    (await models.Supplier.find({}).lean()).map((supplier) => [
      lookupKey(supplier.name),
      {
        id: Number(supplier.id),
        name: String(supplier.name || "").trim(),
      },
    ])
  );
  const seedSupplierNames = [
    ...new Set(
      (Array.isArray(seedData.products) ? seedData.products : [])
        .map((product) => compactLookupText(product?.supplier, "General Supplier"))
        .filter(Boolean)
    ),
  ];

  for (const supplierName of seedSupplierNames) {
    const key = lookupKey(supplierName);
    if (!key || byName.has(key)) continue;

    const id = await nextSequence(COUNTER_KEYS.supplier);
    await models.Supplier.create({
      id,
      name: supplierName,
      createdAt: now,
      updatedAt: now,
    });

    byName.set(key, { id, name: supplierName });
  }

  return byName;
}

async function ensureBootstrapCustomers(now) {
  const byName = new Map(
    (await models.Customer.find({}).lean()).map((customer) => [
      lookupKey(customer.name),
      {
        id: Number(customer.id),
        name: String(customer.name || "").trim(),
      },
    ])
  );

  const seedCustomerNames = [
    ...new Set(
      (Array.isArray(seedData.sales) ? seedData.sales : [])
        .map((sale) => compactLookupText(sale?.customer, "Walk-in Customer"))
        .filter(Boolean)
    ),
  ];

  for (const customerName of seedCustomerNames) {
    const key = lookupKey(customerName);
    if (!key || byName.has(key)) continue;

    const id = await nextSequence(COUNTER_KEYS.customer);
    await models.Customer.create({
      id,
      name: customerName,
      email: "",
      phone: "",
      notes: "",
      isWalkIn: key === "walk-in customer",
      createdAt: now,
      updatedAt: now,
    });

    byName.set(key, { id, name: customerName });
  }

  return byName;
}

async function ensureBootstrapProducts(now, supplierByName = new Map()) {
  const existingProducts = await models.Product.find({}).select({ id: 1, sku: 1, name: 1 }).lean();
  const seenProductIds = new Set(existingProducts.map((product) => Number(product.id)));
  const seenProductSkus = new Set(
    existingProducts.map((product) => lookupKey(product.sku)).filter(Boolean)
  );
  const seenProductNames = new Set(
    existingProducts.map((product) => lookupKey(product.name)).filter(Boolean)
  );

  for (const product of Array.isArray(seedData.products) ? seedData.products : []) {
    const candidateId = Number(product?.id);
    const nextSku = compactLookupText(product?.sku, "");
    const nextName = compactLookupText(product?.name, "");
    const normalizedSku = lookupKey(nextSku);
    const normalizedName = lookupKey(nextName);

    if (!nextName || !nextSku) continue;
    if (
      seenProductIds.has(candidateId) ||
      (normalizedSku && seenProductSkus.has(normalizedSku)) ||
      (normalizedName && seenProductNames.has(normalizedName))
    ) {
      continue;
    }

    const supplierName = compactLookupText(product?.supplier, "General Supplier");
    const supplierRecord = supplierByName.get(lookupKey(supplierName)) || null;
    const id =
      Number.isFinite(candidateId) && candidateId > 0 && !seenProductIds.has(candidateId)
        ? candidateId
        : await nextSequence(COUNTER_KEYS.product);

    await models.Product.create({
      id,
      name: nextName,
      sku: nextSku,
      barcode: "",
      price: Number(product?.price || 0),
      unitCost: estimateUnitCost(product?.price || 0),
      stock: Number(product?.stock || 0),
      category: compactLookupText(product?.category, "General"),
      supplierId: supplierRecord ? Number(supplierRecord.id) : null,
      supplier: supplierRecord ? supplierRecord.name : supplierName,
      ...(normalizeStoredTaxClass(product?.taxClass)
        ? { taxClass: normalizeStoredTaxClass(product?.taxClass) }
        : {}),
      createdAt: now,
      updatedAt: now,
    });

    seenProductIds.add(id);
    if (normalizedSku) seenProductSkus.add(normalizedSku);
    if (normalizedName) seenProductNames.add(normalizedName);
  }
}

async function ensureBootstrapUsers(now) {
  const existingUsers = await models.User.find({}).select({ id: 1, staffId: 1 }).lean();
  const seenUserIds = new Set(existingUsers.map((user) => Number(user.id)));
  const seenStaffIds = new Set(
    existingUsers.map((user) => lookupKey(user.staffId)).filter(Boolean)
  );

  for (const user of Array.isArray(seedData.users) ? seedData.users : []) {
    const staffId = compactLookupText(user?.staffId, "");
    const normalizedStaffId = lookupKey(staffId);
    if (!staffId || !normalizedStaffId || seenStaffIds.has(normalizedStaffId)) continue;

    const role = compactLookupText(user?.role, "Cashier");
    const roleId = await ensureRoleId(role);
    const hashedPin = await bcrypt.hash(String(user?.pin || "0000"), 10);
    const shiftAssignment = getDefaultShiftAssignment(role);
    const candidateId = Number(user?.id);
    const id =
      Number.isFinite(candidateId) && candidateId > 0 && !seenUserIds.has(candidateId)
        ? candidateId
        : await nextSequence(COUNTER_KEYS.user);

    await models.User.create({
      id,
      staffId,
      pinHash: hashedPin,
      fullName: compactLookupText(user?.fullName, "Staff Member"),
      role,
      roleId,
      department: compactLookupText(user?.department, ""),
      email: compactLookupText(user?.email, ""),
      phone: compactLookupText(user?.phone, ""),
      status: compactLookupText(user?.status, "Active"),
      pinStatus: "Assigned",
      invitedAt: now,
      approvedAt: now,
      approvedBy: "System Seed",
      pinUpdatedAt: now,
      shiftAssignment,
      staffNotes: "Seeded baseline staff profile.",
      incidentFlag: "Clear",
      incidentNote: "",
      forcePinChange: runtime.isDevelopment,
      isPinned: false,
      timetable: buildDefaultTimetable(shiftAssignment),
      createdAt: now,
      updatedAt: now,
    });

    seenUserIds.add(id);
    seenStaffIds.add(normalizedStaffId);
  }
}

async function ensureBootstrapSales(now, customerByName = new Map()) {
  const existingSales = await models.Sale.find({}).select({ id: 1 }).lean();
  const seenSales = new Set(existingSales.map((sale) => lookupKey(sale.id)).filter(Boolean));
  const userByName = new Map(
    (await models.User.find({}).select({ id: 1, fullName: 1 }).lean()).map((user) => [
      lookupKey(user.fullName),
      Number(user.id),
    ])
  );
  const productById = new Map(
    (await models.Product.find({}).lean()).map((product) => [Number(product.id), product])
  );

  for (const sale of Array.isArray(seedData.sales) ? seedData.sales : []) {
    const saleId = compactLookupText(sale?.id, "");
    const normalizedSaleId = lookupKey(saleId);
    if (!saleId || !normalizedSaleId || seenSales.has(normalizedSaleId)) continue;

    const saleDate = safeDate(sale?.date)?.toISOString() || now;
    const cashierName = compactLookupText(sale?.cashier, "Front Desk");
    const customerName = compactLookupText(sale?.customer, "Walk-in Customer");
    const customerRecord = customerByName.get(lookupKey(customerName)) || null;
    const items = (Array.isArray(sale?.items) ? sale.items : [])
      .map((item) => {
        const product = productById.get(Number(item?.id)) || null;
        const qty = Number(item?.qty || 0);
        const price = Number(item?.price || 0);
        if (!product || qty <= 0 || price < 0) return null;
        const taxProfile = getProductTaxProfile(product);
        const lineSubtotal = Number((qty * price).toFixed(2));
        const taxRate = Number(item?.taxRate ?? taxProfile.taxRate ?? 0);
        const taxAmount = Number(
          (item?.taxAmount ?? calculateTaxAmount(lineSubtotal, taxRate)).toFixed(2)
        );
        const lineTotal = Number((item?.lineTotal ?? lineSubtotal).toFixed(2));
        const lineGrossTotal = Number(
          (item?.lineGrossTotal ?? lineTotal + taxAmount).toFixed(2)
        );

        return {
          id: Number(product.id),
          name: compactLookupText(item?.name, product.name),
          sku: compactLookupText(item?.sku, product.sku),
          qty,
          price,
          unitCost: Number(product.unitCost || estimateUnitCost(price)),
          taxClass: normalizeStoredTaxClass(item?.taxClass) || taxProfile.taxClass,
          taxCode: compactLookupText(item?.taxCode, taxProfile.taxCode),
          taxLabel: compactLookupText(item?.taxLabel, taxProfile.taxLabel),
          taxRate,
          isTaxable:
            item?.isTaxable === undefined ? Boolean(taxProfile.isTaxable) : Boolean(item.isTaxable),
          lineSubtotal,
          taxAmount,
          lineTotal,
          lineGrossTotal,
          createdAt: saleDate,
          updatedAt: saleDate,
        };
      })
      .filter(Boolean);

    if (!items.length) continue;

    const subtotal = Number(
      items.reduce((sum, item) => sum + Number(item.lineSubtotal || 0), 0).toFixed(2)
    );
    const tax = Number(
      items.reduce((sum, item) => sum + Number(item.taxAmount || 0), 0).toFixed(2)
    );
    const total = Number((subtotal + tax).toFixed(2));

    await models.Sale.create({
      id: saleId,
      subtotal,
      tax,
      total,
      cashierUserId: userByName.get(lookupKey(cashierName)) || null,
      cashier: cashierName,
      customerId: customerRecord ? Number(customerRecord.id) : null,
      customer: customerName,
      status: compactLookupText(sale?.status, "Paid"),
      channel: compactLookupText(sale?.channel, "In-Store"),
      paymentMethod: compactLookupText(sale?.paymentMethod, "Card"),
      date: saleDate,
      createdAt: saleDate,
      updatedAt: saleDate,
      items,
    });

    seenSales.add(normalizedSaleId);
  }
}

async function ensureBootstrapInventoryMovements(now) {
  const hasMovementData = await models.InventoryMovement.exists({});
  if (hasMovementData) return;

  const sales = await models.Sale.find({}).lean();
  for (const sale of sales) {
    for (const item of Array.isArray(sale.items) ? sale.items : []) {
      const movementId = await nextSequence(COUNTER_KEYS.inventoryMovement);
      await models.InventoryMovement.create({
        id: movementId,
        productId: Number(item.id),
        productName: compactLookupText(item.name, ""),
        sku: compactLookupText(item.sku, ""),
        movementType: "sale",
        quantityDelta: Number(item.qty || 0) * -1,
        quantityBefore: null,
        quantityAfter: null,
        referenceType: "sale",
        referenceId: compactLookupText(sale.id, ""),
        note: "Historical seeded sale movement.",
        actorName: compactLookupText(sale.cashier, "System Seed"),
        createdAt: sale.date || now,
      });
    }
  }
}

async function bootstrapSeedData(options = {}) {
  const onlyIfEmpty = options.onlyIfEmpty !== false;
  const now = currentIsoTimestamp();
  const [productCount, userCount, saleCount] = await Promise.all([
    models.Product.countDocuments({}),
    models.User.countDocuments({}),
    models.Sale.countDocuments({}),
  ]);

  if (onlyIfEmpty && (productCount > 0 || userCount > 0 || saleCount > 0)) {
    return {
      applied: false,
      reason: "collections_not_empty",
    };
  }

  const supplierByName = await ensureBootstrapSuppliers(now);
  const customerByName = await ensureBootstrapCustomers(now);
  await ensureBootstrapProducts(now, supplierByName);
  await ensureBootstrapUsers(now);
  await ensureBootstrapSales(now, customerByName);
  await ensureBootstrapInventoryMovements(now);

  return {
    applied: true,
    reason: "bootstrap_completed",
  };
}

function normalizeSettingsPayload(payload = {}) {
  const sanitizeTaxRate = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return defaultSettings.taxRate;
    return Math.min(100, Math.max(0, Number(numeric.toFixed(2))));
  };

  const sanitizeThreshold = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return defaultSettings.lowStockThreshold;
    return Math.max(1, Math.round(numeric));
  };

  const sanitizePercent = (value, fallback) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(100, Math.max(0, Number(numeric.toFixed(2))));
  };

  const sanitizeAutoLockMinutes = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return defaultSettings.autoLockMinutes;
    return Math.max(0, Math.round(numeric));
  };

  return {
    storeName:
      String(payload.storeName ?? defaultSettings.storeName).trim() || defaultSettings.storeName,
    currency:
      String(payload.currency ?? defaultSettings.currency).trim().toUpperCase() || defaultSettings.currency,
    taxRate: sanitizeTaxRate(payload.taxRate),
    receiptFooter:
      String(payload.receiptFooter ?? defaultSettings.receiptFooter).trim() || defaultSettings.receiptFooter,
    notifications: Boolean(payload.notifications ?? defaultSettings.notifications),
    autoPrintReceipt: Boolean(payload.autoPrintReceipt ?? defaultSettings.autoPrintReceipt),
    lowStockThreshold: sanitizeThreshold(payload.lowStockThreshold),
    managerName:
      String(payload.managerName ?? defaultSettings.managerName).trim() || defaultSettings.managerName,
    enableDiscounts: Boolean(payload.enableDiscounts ?? defaultSettings.enableDiscounts),
    requirePinForRefunds: Boolean(
      payload.requirePinForRefunds ?? defaultSettings.requirePinForRefunds
    ),
    showStockWarnings: Boolean(payload.showStockWarnings ?? defaultSettings.showStockWarnings),
    salesEmailReports: Boolean(payload.salesEmailReports ?? defaultSettings.salesEmailReports),
    compactTables: Boolean(payload.compactTables ?? defaultSettings.compactTables),
    dashboardAnimations: Boolean(payload.dashboardAnimations ?? defaultSettings.dashboardAnimations),
    quickCheckout: Boolean(payload.quickCheckout ?? defaultSettings.quickCheckout),
    soundEffects: Boolean(payload.soundEffects ?? defaultSettings.soundEffects),
    branchCode:
      String(payload.branchCode ?? defaultSettings.branchCode).trim() || defaultSettings.branchCode,
    supportEmail:
      String(payload.supportEmail ?? defaultSettings.supportEmail).trim() || defaultSettings.supportEmail,
    supportPhone:
      String(payload.supportPhone ?? defaultSettings.supportPhone).trim() || defaultSettings.supportPhone,
    domain:
      String(payload.domain ?? defaultSettings.domain).trim().toLowerCase() || defaultSettings.domain,
    timeZone:
      String(payload.timeZone ?? defaultSettings.timeZone).trim() || defaultSettings.timeZone,
    defaultReportsView:
      String(payload.defaultReportsView ?? defaultSettings.defaultReportsView).trim() ||
      defaultSettings.defaultReportsView,
    autoLockMinutes: sanitizeAutoLockMinutes(payload.autoLockMinutes),
    billingPlan:
      String(payload.billingPlan ?? defaultSettings.billingPlan).trim() || defaultSettings.billingPlan,
    billingProvider:
      String(payload.billingProvider ?? defaultSettings.billingProvider).trim() ||
      defaultSettings.billingProvider,
    billingContactEmail:
      String(payload.billingContactEmail ?? defaultSettings.billingContactEmail).trim() ||
      defaultSettings.billingContactEmail,
    billingNextBillingDate:
      String(payload.billingNextBillingDate ?? defaultSettings.billingNextBillingDate).trim() ||
      defaultSettings.billingNextBillingDate,
    billingAutoCharge: Boolean(payload.billingAutoCharge ?? defaultSettings.billingAutoCharge),
    customerDiscountMode:
      String(payload.customerDiscountMode ?? defaultSettings.customerDiscountMode).trim() ||
      defaultSettings.customerDiscountMode,
    defaultCustomerDiscountPct: sanitizePercent(
      payload.defaultCustomerDiscountPct,
      defaultSettings.defaultCustomerDiscountPct
    ),
    vipCustomerDiscountPct: sanitizePercent(
      payload.vipCustomerDiscountPct,
      defaultSettings.vipCustomerDiscountPct
    ),
    maxAutoDiscountPct: sanitizePercent(
      payload.maxAutoDiscountPct,
      defaultSettings.maxAutoDiscountPct
    ),
    aiDiscountSuggestions: Boolean(
      payload.aiDiscountSuggestions ?? defaultSettings.aiDiscountSuggestions
    ),
    apiAccessEnabled: Boolean(payload.apiAccessEnabled ?? defaultSettings.apiAccessEnabled),
    apiEnvironmentLabel:
      String(payload.apiEnvironmentLabel ?? defaultSettings.apiEnvironmentLabel).trim() ||
      defaultSettings.apiEnvironmentLabel,
  };
}

function enrichPurchaseOrder(orderDoc) {
  const items = Array.isArray(orderDoc.items) ? orderDoc.items : [];
  const linesCount = items.length;
  const unitsOrdered = items.reduce((sum, item) => sum + Number(item.qtyOrdered || 0), 0);
  const unitsReceived = items.reduce((sum, item) => sum + Number(item.qtyReceived || 0), 0);
  const openUnits = Math.max(0, unitsOrdered - unitsReceived);
  const receivedPercent = unitsOrdered > 0 ? Math.round((unitsReceived / unitsOrdered) * 100) : 0;

  return {
    id: String(orderDoc.id || "").trim(),
    supplierId: orderDoc.supplierId === null || orderDoc.supplierId === undefined ? null : Number(orderDoc.supplierId),
    supplier: String(orderDoc.supplier || "General Supplier").trim() || "General Supplier",
    status: String(orderDoc.status || "Draft").trim() || "Draft",
    note: String(orderDoc.note || "").trim(),
    createdBy: String(orderDoc.createdBy || "").trim(),
    createdAt: toIsoTimestamp(orderDoc.createdAt),
    updatedAt: toIsoTimestamp(orderDoc.updatedAt, orderDoc.createdAt),
    expectedDate: toNullableIsoTimestamp(orderDoc.expectedDate),
    sentAt: toNullableIsoTimestamp(orderDoc.sentAt),
    receivedAt: toNullableIsoTimestamp(orderDoc.receivedAt),
    totalEstimatedCost: Number(orderDoc.totalEstimatedCost || 0),
    linesCount,
    unitsOrdered,
    unitsReceived,
    openUnits,
    receivedPercent,
    items: items.map((item) => ({
      id: Number(item.id),
      productId: Number(item.productId),
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

function enrichCycleCount(countDoc) {
  const items = Array.isArray(countDoc.items) ? countDoc.items : [];
  const linesCount = items.length;
  const varianceLines = items.filter((item) => Number(item.varianceQty || 0) !== 0).length;
  const varianceUnits = items.reduce(
    (sum, item) => sum + Math.abs(Number(item.varianceQty || 0)),
    0
  );

  return {
    id: String(countDoc.id || "").trim(),
    status: String(countDoc.status || "Open").trim() || "Open",
    note: String(countDoc.note || "").trim(),
    createdBy: String(countDoc.createdBy || "").trim(),
    createdAt: toIsoTimestamp(countDoc.createdAt),
    updatedAt: toIsoTimestamp(countDoc.updatedAt, countDoc.createdAt),
    completedAt: toNullableIsoTimestamp(countDoc.completedAt),
    linesCount,
    varianceLines,
    varianceUnits,
    items: items.map((item) => ({
      id: Number(item.id),
      productId: Number(item.productId),
      productName: String(item.productName || "").trim(),
      sku: String(item.sku || "").trim(),
      expectedQty: Number(item.expectedQty || 0),
      countedQty: item.countedQty === null || item.countedQty === undefined ? null : Number(item.countedQty),
      varianceQty: item.varianceQty === null || item.varianceQty === undefined ? null : Number(item.varianceQty),
      status: String(item.status || "Pending").trim() || "Pending",
      createdAt: toIsoTimestamp(item.createdAt),
      updatedAt: toIsoTimestamp(item.updatedAt, item.createdAt),
    })),
  };
}

function assertInitialized() {
  if (!initialized) {
    throw new Error("Mongo store is not initialized. Call initialize() during app startup.");
  }
}

async function ensureCounterAtLeast(key, seq, options = {}) {
  const { session = null } = options;
  const now = currentIsoTimestamp();
  await models.Counter.updateOne(
    { key },
    {
      $max: { seq: Math.max(0, Number(seq || 0)) },
      $set: { updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, session }
  );
}

async function nextSequence(key, options = {}) {
  const { session = null } = options;
  const now = currentIsoTimestamp();
  const counter = await models.Counter.findOneAndUpdate(
    { key },
    {
      $inc: { seq: 1 },
      $set: { updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    {
      upsert: true,
      new: true,
      lean: true,
      session,
    }
  );

  return Number(counter?.seq || 1);
}

function currentMaxFromCache(values = [], mapper = (value) => Number(value?.id || 0), fallback = 0) {
  if (!values.length) return fallback;
  return Math.max(
    fallback,
    ...values.map((value) => mapper(value)).filter((value) => Number.isFinite(value))
  );
}

async function syncCountersFromCache() {
  await Promise.all([
    ensureCounterAtLeast(COUNTER_KEYS.role, currentMaxFromCache(cache.roles)),
    ensureCounterAtLeast(COUNTER_KEYS.supplier, currentMaxFromCache(cache.suppliers)),
    ensureCounterAtLeast(COUNTER_KEYS.customer, currentMaxFromCache(cache.customers)),
    ensureCounterAtLeast(COUNTER_KEYS.product, currentMaxFromCache(cache.products)),
    ensureCounterAtLeast(COUNTER_KEYS.user, currentMaxFromCache(cache.users)),
    ensureCounterAtLeast(
      COUNTER_KEYS.sale,
      currentMaxFromCache(cache.sales, (item) => parseNumericFromId(item.id, 0), 1000)
    ),
    ensureCounterAtLeast(COUNTER_KEYS.inventoryMovement, currentMaxFromCache(cache.inventoryMovements)),
    ensureCounterAtLeast(
      COUNTER_KEYS.purchaseOrder,
      currentMaxFromCache(cache.purchaseOrders, (item) => parseNumericFromId(item.id, 0), 1000)
    ),
    ensureCounterAtLeast(
      COUNTER_KEYS.cycleCount,
      currentMaxFromCache(cache.cycleCounts, (item) => parseNumericFromId(item.id, 0), 1000)
    ),
    ensureCounterAtLeast(COUNTER_KEYS.userAccessEvent, currentMaxFromCache(cache.userAccessEvents)),
    ensureCounterAtLeast(COUNTER_KEYS.userSavedView, currentMaxFromCache(cache.userSavedViews)),
  ]);
}

async function ensureDefaults() {
  const now = currentIsoTimestamp();
  const existingSettings = await models.AppSetting.findOne({ id: 1 }).lean();

  if (!existingSettings) {
    await models.AppSetting.create({
      id: 1,
      ...normalizeSettingsPayload(defaultSettings),
      updatedAt: now,
    });
  }

  for (const definition of CANONICAL_ROLE_DEFINITIONS) {
    const role = await models.Role.findOne({
      name: buildExactMatchRegex(definition.name),
    }).lean();

    if (!role) {
      const id = await nextSequence(COUNTER_KEYS.role);
      await models.Role.create({
        id,
        code: definition.code,
        name: definition.name,
        description: definition.description,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const walkInCustomer = await models.Customer.findOne({
    name: /^walk-in customer$/i,
  }).lean();

  if (!walkInCustomer) {
    const id = await nextSequence(COUNTER_KEYS.customer);
    await models.Customer.create({
      id,
      name: "Walk-in Customer",
      email: "",
      phone: "",
      notes: "",
      isWalkIn: true,
      createdAt: now,
      updatedAt: now,
    });
  }

}

async function loadCache() {
  const [
    roles,
    suppliers,
    customers,
    products,
    users,
    sales,
    inventoryMovements,
    purchaseOrders,
    cycleCounts,
    settings,
    userAccessEvents,
    userSessions,
    userSavedViews,
    auditLogsCount,
  ] = await Promise.all([
    models.Role.find({}).sort({ id: 1 }).lean(),
    models.Supplier.find({}).sort({ name: 1 }).lean(),
    models.Customer.find({}).sort({ name: 1 }).lean(),
    models.Product.find({}).sort({ id: 1 }).lean(),
    models.User.find({}).sort({ id: 1 }).lean(),
    models.Sale.find({}).sort({ updatedAt: -1, date: -1, id: -1 }).lean(),
    models.InventoryMovement.find({}).sort({ createdAt: -1, id: -1 }).lean(),
    models.PurchaseOrder.find({}).sort({ createdAt: -1, id: -1 }).lean(),
    models.CycleCount.find({}).sort({ createdAt: -1, id: -1 }).lean(),
    models.AppSetting.findOne({ id: 1 }).lean(),
    models.UserAccessEvent.find({}).sort({ createdAt: -1, id: -1 }).lean(),
    models.UserSession.find({}).sort({ loginAt: -1, id: -1 }).lean(),
    models.UserSavedView.find({}).sort({ updatedAt: -1, name: 1 }).lean(),
    models.AuditLog.countDocuments({}),
  ]);

  cache.roles = roles.map((row) => ({
    id: Number(row.id),
    code: String(row.code || "").trim(),
    name: String(row.name || "").trim(),
    description: String(row.description || "").trim(),
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
  }));

  cache.suppliers = suppliers.map((row) => ({
    id: Number(row.id),
    name: String(row.name || "").trim(),
    contactName: String(row.contactName || "").trim(),
    email: String(row.email || "").trim(),
    phone: String(row.phone || "").trim(),
    notes: String(row.notes || "").trim(),
    isActive: row.isActive === undefined ? true : Boolean(row.isActive),
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
  }));

  cache.customers = customers.map((row) => ({
    id: Number(row.id),
    name: String(row.name || "").trim(),
    email: String(row.email || "").trim(),
    phone: String(row.phone || "").trim(),
    notes: String(row.notes || "").trim(),
    isWalkIn: Boolean(row.isWalkIn),
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
  }));

  cache.products = products.map((row) => ({
    id: Number(row.id),
    name: String(row.name || "").trim(),
    sku: String(row.sku || "").trim(),
    barcode: String(row.barcode || "").trim(),
    price: Number(row.price || 0),
    unitCost: Number(row.unitCost || 0),
    stock: Number(row.stock || 0),
    category: String(row.category || "General").trim() || "General",
    supplierId: row.supplierId === null || row.supplierId === undefined ? null : Number(row.supplierId),
    supplier: String(row.supplier || "General Supplier").trim() || "General Supplier",
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
  }));

  cache.users = users.map((row) => ({
    id: Number(row.id),
    staffId: String(row.staffId || "").trim(),
    pin: String(row.pinHash || ""),
    fullName: String(row.fullName || "").trim(),
    roleId: row.roleId === null || row.roleId === undefined ? null : Number(row.roleId),
    role: String(row.role || "").trim(),
    department: String(row.department || "").trim(),
    email: String(row.email || "").trim(),
    phone: String(row.phone || "").trim(),
    status: String(row.status || "Active").trim() || "Active",
    pinStatus:
      String(row.pinStatus || (String(row.pinHash || "").trim() ? "Assigned" : "Not Set")).trim() ||
      "Not Set",
    approvedBy: String(row.approvedBy || "").trim(),
    shiftAssignment: String(row.shiftAssignment || "Unassigned").trim() || "Unassigned",
    staffNotes: String(row.staffNotes || "").trim(),
    incidentFlag: String(row.incidentFlag || "Clear").trim() || "Clear",
    incidentNote: String(row.incidentNote || "").trim(),
    forcePinChange: Boolean(row.forcePinChange),
    isPinned: Boolean(row.isPinned),
    timetable: normalizeStoredTimetable(row.timetable, row.shiftAssignment),
    createdAt: toIsoTimestamp(row.createdAt, row.invitedAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
    invitedAt: toNullableIsoTimestamp(row.invitedAt),
    approvedAt: toNullableIsoTimestamp(row.approvedAt),
    pinUpdatedAt: toNullableIsoTimestamp(row.pinUpdatedAt),
  }));

  cache.sales = sales.map((row) => ({
    id: String(row.id || "").trim(),
    subtotal: Number(row.subtotal || 0),
    tax: Number(row.tax || 0),
    total: Number(row.total || 0),
    cashierUserId: row.cashierUserId === null || row.cashierUserId === undefined ? null : Number(row.cashierUserId),
    cashier: String(row.cashier || "Front Desk").trim() || "Front Desk",
    customerId: row.customerId === null || row.customerId === undefined ? null : Number(row.customerId),
    customer: String(row.customer || "Walk-in Customer").trim() || "Walk-in Customer",
    status: String(row.status || "Pending").trim() || "Pending",
    channel: String(row.channel || "In-Store").trim() || "In-Store",
    paymentMethod: String(row.paymentMethod || "Card").trim() || "Card",
    date: toIsoTimestamp(row.date),
    createdAt: toIsoTimestamp(row.createdAt, row.date),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt || row.date),
    items: (Array.isArray(row.items) ? row.items : []).map((item) => ({
      id: Number(item.id),
      name: String(item.name || "").trim(),
      sku: String(item.sku || "").trim(),
      qty: Number(item.qty || 0),
      price: Number(item.price || 0),
      unitCost: Number(item.unitCost || 0),
      createdAt: toIsoTimestamp(item.createdAt, row.createdAt || row.date),
      updatedAt: toIsoTimestamp(item.updatedAt, item.createdAt || row.createdAt || row.date),
    })),
  }));

  cache.inventoryMovements = inventoryMovements.map((row) => ({
    id: Number(row.id),
    productId: Number(row.productId),
    productName: String(row.productName || "").trim(),
    sku: String(row.sku || "").trim(),
    movementType: String(row.movementType || "adjustment").trim(),
    quantityDelta: Number(row.quantityDelta || 0),
    quantityBefore: row.quantityBefore === null || row.quantityBefore === undefined ? null : Number(row.quantityBefore),
    quantityAfter: row.quantityAfter === null || row.quantityAfter === undefined ? null : Number(row.quantityAfter),
    referenceType: String(row.referenceType || "").trim(),
    referenceId: String(row.referenceId || "").trim(),
    note: String(row.note || "").trim(),
    actorName: String(row.actorName || "").trim(),
    createdAt: toIsoTimestamp(row.createdAt),
  }));

  cache.purchaseOrders = purchaseOrders.map(enrichPurchaseOrder);
  cache.cycleCounts = cycleCounts.map(enrichCycleCount);

  const normalizedSettings = normalizeSettingsPayload(settings || defaultSettings);
  cache.settings = {
    ...normalizedSettings,
    updatedAt: toIsoTimestamp(settings?.updatedAt),
  };

  cache.userAccessEvents = userAccessEvents.map((row) => ({
    id: Number(row.id),
    userId: row.userId === null || row.userId === undefined ? null : Number(row.userId),
    staffId: String(row.staffId || "").trim(),
    fullName: String(row.fullName || "").trim(),
    eventType: String(row.eventType || "").trim(),
    title: String(row.title || "").trim(),
    message: String(row.message || "").trim(),
    actorName: String(row.actorName || "").trim(),
    createdAt: toIsoTimestamp(row.createdAt),
  }));

  cache.userSessions = userSessions.map((row) => ({
    id: String(row.id || "").trim(),
    userId: Number(row.userId || 0),
    staffId: String(row.staffId || "").trim(),
    fullName: String(row.fullName || "").trim(),
    status: String(row.status || "Active").trim() || "Active",
    loginAt: toIsoTimestamp(row.loginAt),
    lastSeenAt: toIsoTimestamp(row.lastSeenAt, row.loginAt),
    logoutAt: toNullableIsoTimestamp(row.logoutAt),
    loginReason: String(row.loginReason || "").trim(),
    logoutReason: String(row.logoutReason || "").trim(),
  }));

  cache.userSavedViews = userSavedViews.map((row) => ({
    id: Number(row.id),
    ownerUserId: Number(row.ownerUserId || 0),
    pageKey: String(row.pageKey || "users").trim() || "users",
    name: String(row.name || "").trim(),
    config: row.config && typeof row.config === "object" ? clone(row.config) : {},
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
  }));

  cache.auditLogsCount = Number(auditLogsCount || 0);

  initialized = true;
}

async function refreshCache() {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    await loadCache();
    await syncCountersFromCache();
    await refreshMongoDeploymentInfo();
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function initialize() {
  if (initializePromise) {
    return initializePromise;
  }

  initializePromise = (async () => {
    await ensureDefaults();
    await refreshCache();
    return true;
  })();

  try {
    await initializePromise;
  } catch (error) {
    initializePromise = null;
    throw error;
  }

  return initializePromise;
}

function enqueueWrite(operation) {
  const task = writeQueue.then(
    async () => {
      await initialize();
      const result = await operation();
      await refreshCache();
      return typeof result === "function" ? result() : result;
    },
    async () => {
      await initialize();
      const result = await operation();
      await refreshCache();
      return typeof result === "function" ? result() : result;
    }
  );

  writeQueue = task.catch(() => {});
  return task;
}

async function ensureRoleId(name, options = {}) {
  const { session = null } = options;
  const normalized = compactLookupText(name);
  if (!normalized) return null;

  const existing = await applySessionToQuery(
    models.Role.findOne({
      name: buildExactMatchRegex(normalized),
    }).lean(),
    session
  );

  if (existing) {
    return Number(existing.id);
  }

  const now = currentIsoTimestamp();
  const id = await nextSequence(COUNTER_KEYS.role, { session });
  await models.Role.create(
    [
      {
        id,
        code: lookupKey(normalized).replace(/[^a-z0-9]+/g, "_") || `role_${id}`,
        name: normalized,
        description: "Runtime-created role.",
        createdAt: now,
        updatedAt: now,
      },
    ],
    { session }
  );

  return id;
}

async function ensureSupplierId(name, options = {}) {
  const { session = null } = options;
  const normalized = compactLookupText(name, "General Supplier");
  const existing = await applySessionToQuery(
    models.Supplier.findOne({
      name: buildExactMatchRegex(normalized),
    }).lean(),
    session
  );

  if (existing) {
    return Number(existing.id);
  }

  const now = currentIsoTimestamp();
  const id = await nextSequence(COUNTER_KEYS.supplier, { session });
  await models.Supplier.create(
    [
      {
        id,
        name: normalized,
        createdAt: now,
        updatedAt: now,
      },
    ],
    { session }
  );
  return id;
}

async function ensureCustomerId(name, options = {}) {
  const { session = null } = options;
  const normalized = compactLookupText(name, "Walk-in Customer");
  const existing = await applySessionToQuery(
    models.Customer.findOne({
      name: buildExactMatchRegex(normalized),
    }).lean(),
    session
  );

  if (existing) {
    return Number(existing.id);
  }

  const now = currentIsoTimestamp();
  const id = await nextSequence(COUNTER_KEYS.customer, { session });
  await models.Customer.create(
    [
      {
        id,
        name: normalized,
        email: "",
        phone: "",
        notes: "",
        isWalkIn: lookupKey(normalized) === "walk-in customer",
        createdAt: now,
        updatedAt: now,
      },
    ],
    { session }
  );

  return id;
}

function resolveUserIdByIdentity(identity) {
  const normalized = lookupKey(identity);
  if (!normalized) return null;
  const byName = cache.users.find((user) => lookupKey(user.fullName) === normalized);
  if (byName) return Number(byName.id);
  const byStaffId = cache.users.find((user) => lookupKey(user.staffId) === normalized);
  return byStaffId ? Number(byStaffId.id) : null;
}

function getRoles() {
  assertInitialized();
  return clone(cache.roles);
}

function getSuppliers() {
  assertInitialized();
  return clone(cache.suppliers);
}

function getSupplierById(id) {
  assertInitialized();
  const supplier = cache.suppliers.find((item) => Number(item.id) === Number(id));
  return supplier ? clone(supplier) : null;
}

function getCustomers() {
  assertInitialized();
  return clone(cache.customers);
}

function getCustomerById(id) {
  assertInitialized();
  const customer = cache.customers.find((item) => Number(item.id) === Number(id));
  return customer ? clone(customer) : null;
}

function findSupplierByName(name, excludeId = null) {
  assertInitialized();
  const normalized = lookupKey(name);
  if (!normalized) return null;
  const excludedId = excludeId === null || excludeId === undefined ? null : Number(excludeId);
  const supplier = cache.suppliers.find(
    (item) =>
      lookupKey(item.name) === normalized && (excludedId === null || Number(item.id) !== excludedId)
  );
  return supplier ? clone(supplier) : null;
}

function findCustomerByName(name, excludeId = null) {
  assertInitialized();
  const normalized = lookupKey(name);
  if (!normalized) return null;
  const excludedId = excludeId === null || excludeId === undefined ? null : Number(excludeId);
  const customer = cache.customers.find(
    (item) =>
      lookupKey(item.name) === normalized && (excludedId === null || Number(item.id) !== excludedId)
  );
  return customer ? clone(customer) : null;
}

function getProducts() {
  assertInitialized();
  return clone(cache.products);
}

function getProductById(id) {
  assertInitialized();
  const product = cache.products.find((item) => Number(item.id) === Number(id));
  return product ? clone(product) : null;
}

function getNextProductId() {
  assertInitialized();
  const max = cache.products.length ? Math.max(...cache.products.map((item) => Number(item.id))) : 0;
  return Number(max || 0) + 1;
}

function getNextSupplierId() {
  assertInitialized();
  const max = cache.suppliers.length ? Math.max(...cache.suppliers.map((item) => Number(item.id))) : 0;
  return Number(max || 0) + 1;
}

function getNextCustomerId() {
  assertInitialized();
  const max = cache.customers.length ? Math.max(...cache.customers.map((item) => Number(item.id))) : 0;
  return Number(max || 0) + 1;
}

async function createSupplier(supplier) {
  return enqueueWrite(async () => {
    const hasExplicitId = supplier.id !== null && supplier.id !== undefined;
    const id = hasExplicitId ? Number(supplier.id) : await nextSequence(COUNTER_KEYS.supplier);
    const now = currentIsoTimestamp();
    const createdAt = String(supplier.createdAt || now);
    const updatedAt = String(supplier.updatedAt || createdAt);

    await models.Supplier.create({
      id,
      name: String(supplier.name || "").trim(),
      contactName: String(supplier.contactName || "").trim(),
      email: String(supplier.email || "").trim(),
      phone: String(supplier.phone || "").trim(),
      notes: String(supplier.notes || "").trim(),
      isActive: supplier.isActive === undefined ? true : Boolean(supplier.isActive),
      createdAt,
      updatedAt,
    });

    if (hasExplicitId) {
      await ensureCounterAtLeast(COUNTER_KEYS.supplier, id);
    }

    return () => getSupplierById(id);
  });
}

async function updateSupplier(id, supplier) {
  return enqueueWrite(async () =>
    executeWriteWithOptionalTransaction(async ({ session }) => {
      const existing = getSupplierById(id);
      if (!existing) return null;

      const supplierId = Number(id);
      const previousName = String(existing.name || "").trim();
      const nextName = String(supplier.name || previousName).trim() || previousName;
      const updatedAt = String(supplier.updatedAt || currentIsoTimestamp());

      await applySessionToQuery(
        models.Supplier.updateOne(
          { id: supplierId },
          {
            $set: {
              name: nextName,
              contactName: String(supplier.contactName || "").trim(),
              email: String(supplier.email || "").trim(),
              phone: String(supplier.phone || "").trim(),
              notes: String(supplier.notes || "").trim(),
              isActive: supplier.isActive === undefined ? Boolean(existing.isActive) : Boolean(supplier.isActive),
              updatedAt,
            },
          }
        ),
        session
      );

      if (lookupKey(previousName) !== lookupKey(nextName)) {
        await Promise.all([
          applySessionToQuery(
            models.Product.updateMany(
              {
                $or: [{ supplierId }, { supplier: buildExactMatchRegex(previousName) }],
              },
              {
                $set: {
                  supplier: nextName,
                  updatedAt,
                },
              }
            ),
            session
          ),
          applySessionToQuery(
            models.PurchaseOrder.updateMany(
              {
                $or: [{ supplierId }, { supplier: buildExactMatchRegex(previousName) }],
              },
              {
                $set: {
                  supplier: nextName,
                  updatedAt,
                },
              }
            ),
            session
          ),
        ]);
      }

      return () => getSupplierById(supplierId);
    })
  );
}

async function deleteSupplier(id) {
  return enqueueWrite(async () =>
    executeWriteWithOptionalTransaction(async ({ session }) => {
      const existing = getSupplierById(id);
      if (!existing) return null;

      const supplierId = Number(id);
      const [productReference, orderReference] = await Promise.all([
        applySessionToQuery(
          models.Product.findOne({
            $or: [{ supplierId }, { supplier: buildExactMatchRegex(existing.name) }],
          })
            .select({ id: 1 })
            .lean(),
          session
        ),
        applySessionToQuery(
          models.PurchaseOrder.findOne({
            $or: [{ supplierId }, { supplier: buildExactMatchRegex(existing.name) }],
          })
            .select({ id: 1 })
            .lean(),
          session
        ),
      ]);

      if (productReference || orderReference) {
        throw new Error("Supplier is referenced by existing records.");
      }

      await applySessionToQuery(models.Supplier.deleteOne({ id: supplierId }), session);
      return existing;
    })
  );
}

async function createCustomer(customer) {
  return enqueueWrite(async () => {
    const hasExplicitId = customer.id !== null && customer.id !== undefined;
    const id = hasExplicitId ? Number(customer.id) : await nextSequence(COUNTER_KEYS.customer);
    const now = currentIsoTimestamp();
    const createdAt = String(customer.createdAt || now);
    const updatedAt = String(customer.updatedAt || createdAt);

    await models.Customer.create({
      id,
      name: String(customer.name || "").trim(),
      email: String(customer.email || "").trim(),
      phone: String(customer.phone || "").trim(),
      notes: String(customer.notes || "").trim(),
      isWalkIn: Boolean(customer.isWalkIn),
      createdAt,
      updatedAt,
    });

    if (hasExplicitId) {
      await ensureCounterAtLeast(COUNTER_KEYS.customer, id);
    }

    return () => getCustomerById(id);
  });
}

async function updateCustomer(id, customer) {
  return enqueueWrite(async () =>
    executeWriteWithOptionalTransaction(async ({ session }) => {
      const existing = getCustomerById(id);
      if (!existing) return null;

      const customerId = Number(id);
      const previousName = String(existing.name || "").trim();
      const nextName = String(customer.name || previousName).trim() || previousName;
      const updatedAt = String(customer.updatedAt || currentIsoTimestamp());

      await applySessionToQuery(
        models.Customer.updateOne(
          { id: customerId },
          {
            $set: {
              name: nextName,
              email: String(customer.email || "").trim(),
              phone: String(customer.phone || "").trim(),
              notes: String(customer.notes || "").trim(),
              isWalkIn: Boolean(existing.isWalkIn),
              updatedAt,
            },
          }
        ),
        session
      );

      if (lookupKey(previousName) !== lookupKey(nextName)) {
        await applySessionToQuery(
          models.Sale.updateMany(
            {
              $or: [{ customerId }, { customer: buildExactMatchRegex(previousName) }],
            },
            {
              $set: {
                customer: nextName,
                updatedAt,
              },
            }
          ),
          session
        );
      }

      return () => getCustomerById(customerId);
    })
  );
}

async function deleteCustomer(id) {
  return enqueueWrite(async () =>
    executeWriteWithOptionalTransaction(async ({ session }) => {
      const existing = getCustomerById(id);
      if (!existing) return null;

      if (existing.isWalkIn) {
        throw new Error("Walk-in customer cannot be deleted.");
      }

      const customerId = Number(id);
      const saleReference = await applySessionToQuery(
        models.Sale.findOne({
          $or: [{ customerId }, { customer: buildExactMatchRegex(existing.name) }],
        })
          .select({ id: 1 })
          .lean(),
        session
      );

      if (saleReference) {
        throw new Error("Customer is referenced by existing records.");
      }

      await applySessionToQuery(models.Customer.deleteOne({ id: customerId }), session);
      return existing;
    })
  );
}

function findProductByName(name, excludeId = null) {
  assertInitialized();
  const normalized = lookupKey(name);
  if (!normalized) return null;
  const excludedId = excludeId === null || excludeId === undefined ? null : Number(excludeId);
  const product = cache.products.find(
    (item) =>
      lookupKey(item.name) === normalized && (excludedId === null || Number(item.id) !== excludedId)
  );
  return product ? clone(product) : null;
}

function findProductBySku(sku, excludeId = null) {
  assertInitialized();
  const normalized = lookupKey(sku);
  if (!normalized) return null;
  const excludedId = excludeId === null || excludeId === undefined ? null : Number(excludeId);
  const product = cache.products.find(
    (item) =>
      lookupKey(item.sku) === normalized && (excludedId === null || Number(item.id) !== excludedId)
  );
  return product ? clone(product) : null;
}

function findProductByBarcode(barcode, excludeId = null) {
  assertInitialized();
  const normalized = lookupKey(barcode);
  if (!normalized) return null;
  const excludedId = excludeId === null || excludeId === undefined ? null : Number(excludeId);
  const product = cache.products.find(
    (item) =>
      lookupKey(item.barcode) === normalized && (excludedId === null || Number(item.id) !== excludedId)
  );
  return product ? clone(product) : null;
}

function getUsers() {
  assertInitialized();
  return clone(cache.users);
}

function getUserById(id) {
  assertInitialized();
  const user = cache.users.find((item) => Number(item.id) === Number(id));
  return user ? clone(user) : null;
}

function getUserByStaffId(staffId) {
  assertInitialized();
  const normalized = lookupKey(staffId);
  if (!normalized) return null;
  const user = cache.users.find((item) => lookupKey(item.staffId) === normalized);
  return user ? clone(user) : null;
}

function getUserAccessEvents(userId, limit = 20) {
  assertInitialized();
  return clone(
    cache.userAccessEvents
      .filter((event) => Number(event.userId) === Number(userId))
      .slice(0, Number(limit || 20))
  );
}

function getUserSessions(userId, limit = 12) {
  assertInitialized();
  return clone(
    cache.userSessions
      .filter((session) => Number(session.userId) === Number(userId))
      .slice(0, Number(limit || 12))
  );
}

function getUserSessionById(sessionId) {
  assertInitialized();
  const session = cache.userSessions.find((item) => String(item.id) === String(sessionId));
  return session ? clone(session) : null;
}

function countRecentLoginFailuresForStaffId(staffId, windowMinutes = 15) {
  assertInitialized();
  const normalizedStaffId = String(staffId || "").trim().toUpperCase();
  if (!normalizedStaffId) return 0;
  const cutoff = Date.now() - Number(windowMinutes || 15) * 60 * 1000;

  return cache.userAccessEvents.filter((event) => {
    if (String(event.eventType || "").trim() !== "login_failed") return false;
    if (String(event.staffId || "").trim().toUpperCase() !== normalizedStaffId) return false;
    const eventDate = safeDate(event.createdAt);
    return eventDate ? eventDate.getTime() >= cutoff : false;
  }).length;
}

function getUserSessionSummary(userId) {
  const sessions = getUserSessions(userId, 8);
  const activeSessions = sessions.filter((session) => String(session.status || "").trim() === "Active");
  const lastLogin = sessions[0] || null;
  const lastLogout = sessions.find((session) => session.logoutAt) || null;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const failedLoginCount = getUserAccessEvents(userId, 50).filter((event) => {
    if (String(event.eventType || "").trim() !== "login_failed") return false;
    const eventDate = safeDate(event.createdAt);
    return eventDate ? eventDate.getTime() >= weekAgo : false;
  }).length;

  return {
    activeSessionCount: activeSessions.length,
    lastLoginAt: lastLogin?.loginAt || null,
    lastSeenAt: activeSessions[0]?.lastSeenAt || lastLogin?.lastSeenAt || null,
    lastLogoutAt: lastLogout?.logoutAt || null,
    failedLoginCount7d: Number(failedLoginCount || 0),
    sessions,
  };
}

function getUserOversight(userId) {
  return {
    summary: getUserSessionSummary(userId),
    events: getUserAccessEvents(userId, 20),
    sessions: getUserSessions(userId, 8),
  };
}

function getNextUserId() {
  assertInitialized();
  const max = cache.users.length ? Math.max(...cache.users.map((item) => Number(item.id))) : 0;
  return Number(max || 0) + 1;
}

async function insertInventoryMovementDoc(entry, options = {}) {
  const { session = null, product: providedProduct = null } = options;
  const product =
    providedProduct ||
    cache.products.find((item) => Number(item.id) === Number(entry.productId)) ||
    (await applySessionToQuery(
      models.Product.findOne({ id: Number(entry.productId) }).lean(),
      session
    ));
  const id = await nextSequence(COUNTER_KEYS.inventoryMovement, { session });
  const createdAt = String(entry.createdAt || currentIsoTimestamp());

  await models.InventoryMovement.create(
    [
      {
        id,
        productId: Number(entry.productId),
        productName: String(entry.productName || product?.name || "").trim(),
        sku: String(entry.sku || product?.sku || "").trim(),
        movementType: String(entry.movementType || "adjustment").trim(),
        quantityDelta: Number(entry.quantityDelta || 0),
        quantityBefore:
          entry.quantityBefore === null || entry.quantityBefore === undefined
            ? null
            : Number(entry.quantityBefore),
        quantityAfter:
          entry.quantityAfter === null || entry.quantityAfter === undefined
            ? null
            : Number(entry.quantityAfter),
        referenceType: String(entry.referenceType || "").trim(),
        referenceId: String(entry.referenceId || "").trim(),
        note: String(entry.note || "").trim(),
        actorName: String(entry.actorName || "").trim(),
        createdAt,
      },
    ],
    { session }
  );

  return id;
}

async function logUserAccessEvent(entry = {}) {
  const id = await nextSequence(COUNTER_KEYS.userAccessEvent);
  await models.UserAccessEvent.create({
    id,
    userId: entry.userId === null || entry.userId === undefined ? null : Number(entry.userId),
    staffId: String(entry.staffId || "").trim(),
    fullName: String(entry.fullName || "").trim(),
    eventType: String(entry.eventType || "").trim(),
    title: String(entry.title || "").trim(),
    message: String(entry.message || "").trim(),
    actorName: String(entry.actorName || "").trim(),
    createdAt: String(entry.createdAt || currentIsoTimestamp()),
  });
  return id;
}

async function createProduct(product) {
  return enqueueWrite(async () => {
    const id = Number(product.id || getNextProductId());
    const supplier = compactLookupText(product.supplier, "General Supplier");
    const supplierId =
      product.supplierId === null || product.supplierId === undefined
        ? await ensureSupplierId(supplier)
        : Number(product.supplierId);
    const now = currentIsoTimestamp();
    const createdAt = String(product.createdAt || now);
    const updatedAt = String(product.updatedAt || createdAt);

    await models.Product.create({
      id,
      name: String(product.name || "").trim(),
      sku: String(product.sku || "").trim(),
      barcode: String(product.barcode || "").trim(),
      price: Number(product.price || 0),
      unitCost: Number(product.unitCost || 0),
      stock: Number(product.stock || 0),
      category: String(product.category || "General").trim() || "General",
      supplierId,
      supplier,
      createdAt,
      updatedAt,
    });

    await ensureCounterAtLeast(COUNTER_KEYS.product, id);
    return () => getProductById(id);
  });
}

async function updateProduct(id, product) {
  return enqueueWrite(async () => {
    const existing = getProductById(id);
    if (!existing) return null;

    const supplier = compactLookupText(product.supplier, "General Supplier");
    const supplierId =
      product.supplierId === null || product.supplierId === undefined
        ? await ensureSupplierId(supplier)
        : Number(product.supplierId);

    await models.Product.updateOne(
      { id: Number(id) },
      {
        $set: {
          name: String(product.name || "").trim(),
          sku: String(product.sku || "").trim(),
          barcode: String(product.barcode || "").trim(),
          price: Number(product.price || 0),
          unitCost: Number(product.unitCost || 0),
          stock: Number(product.stock || 0),
          category: String(product.category || "General").trim() || "General",
          supplier,
          supplierId,
          updatedAt: String(product.updatedAt || currentIsoTimestamp()),
        },
      }
    );

    return () => getProductById(id);
  });
}

async function deleteProduct(id) {
  return enqueueWrite(async () => {
    const existing = getProductById(id);
    if (!existing) return null;

    const productId = Number(id);
    const [saleReference, movementReference, orderReference, countReference] = await Promise.all([
      models.Sale.findOne({ "items.id": productId }).select({ id: 1 }).lean(),
      models.InventoryMovement.findOne({ productId }).select({ id: 1 }).lean(),
      models.PurchaseOrder.findOne({ "items.productId": productId }).select({ id: 1 }).lean(),
      models.CycleCount.findOne({ "items.productId": productId }).select({ id: 1 }).lean(),
    ]);

    if (saleReference || movementReference || orderReference || countReference) {
      throw new Error("Product is referenced by existing records.");
    }

    await models.Product.deleteOne({ id: productId });
    return existing;
  });
}

async function restockProduct(id, amount) {
  return enqueueWrite(async () => {
    const now = currentIsoTimestamp();
    await models.Product.updateOne(
      { id: Number(id) },
      {
        $inc: { stock: Number(amount || 0) },
        $set: { updatedAt: now },
      }
    );
    return () => getProductById(id);
  });
}

async function restockProductWithMovement(id, amount, movement = {}) {
  return enqueueWrite(async () =>
    executeWriteWithOptionalTransaction(async ({ session }) => {
      const existing = getProductById(id);
      if (!existing) return null;

      const restockAmount = Number(amount || 0);
      const now = String(movement.createdAt || currentIsoTimestamp());

      await models.Product.updateOne(
        { id: Number(id) },
        {
          $inc: { stock: restockAmount },
          $set: { updatedAt: now },
        },
        { session }
      );

      await insertInventoryMovementDoc(
        {
          productId: Number(existing.id),
          productName: existing.name,
          sku: existing.sku,
          movementType: String(movement.movementType || "restock").trim(),
          quantityDelta: restockAmount,
          quantityBefore: Number(existing.stock || 0),
          quantityAfter: Number(existing.stock || 0) + restockAmount,
          referenceType: String(movement.referenceType || "product").trim(),
          referenceId: String(movement.referenceId || existing.id),
          note: String(movement.note || "").trim(),
          actorName: String(movement.actorName || "").trim(),
          createdAt: now,
        },
        {
          session,
          product: existing,
        }
      );

      return () => getProductById(id);
    })
  );
}

async function createUserSession(user, options = {}) {
  return enqueueWrite(async () => {
    if (!user?.id) return null;

    const sessionId = String(options.sessionId || crypto.randomUUID()).trim();
    const loginAt = String(options.loginAt || currentIsoTimestamp());
    const loginReason = String(options.loginReason || "Interactive login").trim();

    await models.UserSession.create({
      id: sessionId,
      userId: Number(user.id),
      staffId: String(user.staffId || "").trim(),
      fullName: String(user.fullName || "").trim(),
      status: "Active",
      loginAt,
      lastSeenAt: loginAt,
      logoutAt: null,
      loginReason,
      logoutReason: "",
    });

    await logUserAccessEvent({
      userId: user.id,
      staffId: user.staffId,
      fullName: user.fullName,
      eventType: "login_success",
      title: "Signed in",
      message: "The staff member signed into the workspace successfully.",
      actorName: String(user.fullName || user.staffId || "Staff").trim(),
      createdAt: loginAt,
    });

    return () => getUserSessionById(sessionId);
  });
}

async function touchUserSession(sessionId, touchedAt = currentIsoTimestamp()) {
  return enqueueWrite(async () => {
    const normalizedId = String(sessionId || "").trim();
    if (!normalizedId) return null;

    await models.UserSession.updateOne(
      { id: normalizedId, status: "Active" },
      {
        $set: {
          lastSeenAt: String(touchedAt || currentIsoTimestamp()),
        },
      }
    );

    return () => getUserSessionById(normalizedId);
  });
}

async function closeUserSession(sessionId, options = {}) {
  return enqueueWrite(async () => {
    const normalizedId = String(sessionId || "").trim();
    if (!normalizedId) return null;

    const existing = getUserSessionById(normalizedId);
    if (!existing) return null;

    if (String(existing.status || "").trim() !== "Active") {
      return existing;
    }

    const logoutAt = String(options.logoutAt || currentIsoTimestamp());
    const logoutReason = String(options.logoutReason || "Manual logout").trim();

    await models.UserSession.updateOne(
      { id: normalizedId },
      {
        $set: {
          status: "Closed",
          logoutAt,
          lastSeenAt: logoutAt,
          logoutReason,
        },
      }
    );

    await logUserAccessEvent({
      userId: existing.userId,
      staffId: existing.staffId,
      fullName: existing.fullName,
      eventType: "logout",
      title: "Signed out",
      message: "The staff member ended the workspace session.",
      actorName: String(existing.fullName || existing.staffId || "Staff").trim(),
      createdAt: logoutAt,
    });

    return () => getUserSessionById(normalizedId);
  });
}

async function recordUserLoginFailure(staffId, reason = "Invalid Staff ID or PIN.") {
  return enqueueWrite(async () => {
    const normalizedStaffId = String(staffId || "").trim().toUpperCase();
    const existing = normalizedStaffId ? getUserByStaffId(normalizedStaffId) : null;

    await logUserAccessEvent({
      userId: existing?.id ?? null,
      staffId: existing?.staffId || normalizedStaffId,
      fullName: existing?.fullName || "",
      eventType: "login_failed",
      title: "Login failed",
      message: String(reason || "Invalid Staff ID or PIN.").trim(),
      actorName: "Auth",
      createdAt: currentIsoTimestamp(),
    });

    return null;
  });
}

async function createUser(user, actorName = "") {
  return enqueueWrite(async () => {
    const invitedAt = String(user.invitedAt || currentIsoTimestamp());
    const createdAt = String(user.createdAt || invitedAt);
    const approvedAt =
      String(user.status || "Active").trim() === "Active"
        ? String(user.approvedAt || invitedAt)
        : null;
    const approvedBy =
      String(user.status || "Active").trim() === "Active"
        ? String(user.approvedBy || "").trim()
        : "";
    const pinUpdatedAt = String(user.pin || "").trim()
      ? String(user.pinUpdatedAt || approvedAt || invitedAt)
      : null;
    const shiftAssignment =
      String(user.shiftAssignment || "").trim() || getDefaultShiftAssignment(user.role);
    const roleName = compactLookupText(user.role);
    const roleId = await ensureRoleId(roleName);
    const timetable = normalizeStoredTimetable(user.timetable, shiftAssignment);
    const id = Number(user.id || getNextUserId());

    await models.User.create({
      id,
      staffId: String(user.staffId || "").trim(),
      pinHash: String(user.pin || ""),
      fullName: String(user.fullName || "").trim(),
      role: roleName,
      roleId,
      department: String(user.department || "").trim(),
      email: String(user.email || "").trim(),
      phone: String(user.phone || "").trim(),
      status: String(user.status || "Active").trim() || "Active",
      pinStatus: String(user.pinStatus || "").trim() || (String(user.pin || "").trim() ? "Assigned" : "Not Set"),
      invitedAt,
      approvedAt,
      approvedBy,
      pinUpdatedAt,
      shiftAssignment,
      staffNotes: String(user.staffNotes || "").trim(),
      incidentFlag: String(user.incidentFlag || "Clear").trim() || "Clear",
      incidentNote: String(user.incidentNote || "").trim(),
      forcePinChange: Boolean(user.forcePinChange),
      isPinned: Boolean(user.isPinned),
      timetable,
      createdAt,
      updatedAt: String(user.updatedAt || createdAt),
    });

    await ensureCounterAtLeast(COUNTER_KEYS.user, id);
    await logUserAccessEvent({
      userId: id,
      staffId: user.staffId,
      fullName: user.fullName,
      eventType: "record_created",
      title: "Staff record created",
      message: "The staff account was added to the roster and is waiting for access setup.",
      actorName: String(actorName || approvedBy || "Roster Admin").trim(),
      createdAt: invitedAt,
    });

    return () => getUserById(id);
  });
}

async function updateUser(id, user, actorName = "") {
  return enqueueWrite(async () => {
    const existing = getUserById(id);
    if (!existing) return null;

    const shiftAssignment =
      String(user.shiftAssignment || "").trim() || getDefaultShiftAssignment(user.role);
    const timetable = normalizeStoredTimetable(user.timetable ?? existing.timetable, shiftAssignment);
    const roleName = compactLookupText(user.role);
    const roleId = await ensureRoleId(roleName);

    await models.User.updateOne(
      { id: Number(id) },
      {
        $set: {
          staffId: String(user.staffId || "").trim(),
          fullName: String(user.fullName || "").trim(),
          role: roleName,
          roleId,
          department: String(user.department || "").trim(),
          email: String(user.email || "").trim(),
          phone: String(user.phone || "").trim(),
          status: String(user.status || "Active").trim() || "Active",
          shiftAssignment,
          staffNotes: String(user.staffNotes || "").trim(),
          incidentFlag: String(user.incidentFlag || "Clear").trim() || "Clear",
          incidentNote: String(user.incidentNote || "").trim(),
          forcePinChange: Boolean(user.forcePinChange),
          isPinned: Boolean(user.isPinned),
          timetable,
          updatedAt: currentIsoTimestamp(),
        },
      }
    );

    await logUserAccessEvent({
      userId: existing.id,
      staffId: user.staffId,
      fullName: user.fullName,
      eventType: "profile_updated",
      title: "Profile updated",
      message: "Staff role, department, or contact details were updated.",
      actorName: String(actorName || "Roster Admin").trim(),
      createdAt: currentIsoTimestamp(),
    });

    return () => getUserById(id);
  });
}

async function assignUserPin(id, pinHash, actorName = "") {
  return enqueueWrite(async () => {
    const existing = getUserById(id);
    if (!existing) return null;

    const pinUpdatedAt = currentIsoTimestamp();
    await models.User.updateOne(
      { id: Number(id) },
      {
        $set: {
          pinHash: String(pinHash || ""),
          pinStatus: "Assigned",
          pinUpdatedAt,
          forcePinChange: true,
          updatedAt: pinUpdatedAt,
        },
      }
    );

    await logUserAccessEvent({
      userId: existing.id,
      staffId: existing.staffId,
      fullName: existing.fullName,
      eventType: existing.pinStatus === "Assigned" ? "pin_reset" : "pin_assigned",
      title: existing.pinStatus === "Assigned" ? "PIN reset" : "PIN assigned",
      message:
        existing.pinStatus === "Assigned"
          ? "The sign-in PIN was reset for this account and must be changed on next login."
          : "A sign-in PIN was issued for this account and must be changed on first login.",
      actorName: String(actorName || "Owner").trim(),
      createdAt: pinUpdatedAt,
    });

    return () => getUserById(id);
  });
}

async function approveUserAccess(id, actorName = "") {
  return enqueueWrite(async () => {
    const existing = getUserById(id);
    if (!existing) return null;
    const approvedAt = currentIsoTimestamp();

    await models.User.updateOne(
      { id: Number(id) },
      {
        $set: {
          status: "Active",
          approvedAt,
          approvedBy: String(actorName || "").trim(),
          updatedAt: approvedAt,
        },
      }
    );

    await logUserAccessEvent({
      userId: existing.id,
      staffId: existing.staffId,
      fullName: existing.fullName,
      eventType: "access_approved",
      title: "Access approved",
      message: "The account was approved for live sign-in access.",
      actorName,
      createdAt: approvedAt,
    });

    return () => getUserById(id);
  });
}

async function updateUserAccessStatus(id, status, actorName = "") {
  return enqueueWrite(async () => {
    const existing = getUserById(id);
    if (!existing) return null;
    const normalizedStatus = String(status || "").trim();

    await models.User.updateOne(
      { id: Number(id) },
      {
        $set: {
          status: normalizedStatus,
          updatedAt: currentIsoTimestamp(),
        },
      }
    );

    await logUserAccessEvent({
      userId: existing.id,
      staffId: existing.staffId,
      fullName: existing.fullName,
      eventType: normalizedStatus === "Active" ? "access_activated" : "access_deactivated",
      title: normalizedStatus === "Active" ? "Access activated" : "Access deactivated",
      message:
        normalizedStatus === "Active"
          ? "The account was set back to active sign-in status."
          : "The account was turned off and can no longer sign in.",
      actorName: String(actorName || "Owner").trim(),
      createdAt: currentIsoTimestamp(),
    });

    return () => getUserById(id);
  });
}

async function updateUserWorkforceProfile(id, profile = {}, actorName = "") {
  return enqueueWrite(async () => {
    const existing = getUserById(id);
    if (!existing) return null;

    const nextShiftAssignment =
      String(profile.shiftAssignment ?? existing.shiftAssignment ?? "").trim() ||
      getDefaultShiftAssignment(existing.role);
    const nextStaffNotes = String(profile.staffNotes ?? existing.staffNotes ?? "").trim();
    const nextIncidentFlag = String(profile.incidentFlag ?? existing.incidentFlag ?? "Clear").trim() || "Clear";
    const nextIncidentNote = String(profile.incidentNote ?? existing.incidentNote ?? "").trim();
    const nextIsPinned = Boolean(profile.isPinned ?? existing.isPinned);
    const nextTimetable = normalizeStoredTimetable(profile.timetable ?? existing.timetable, nextShiftAssignment);

    await models.User.updateOne(
      { id: Number(id) },
      {
        $set: {
          shiftAssignment: nextShiftAssignment,
          staffNotes: nextStaffNotes,
          incidentFlag: nextIncidentFlag,
          incidentNote: nextIncidentNote,
          isPinned: nextIsPinned,
          timetable: nextTimetable,
          updatedAt: currentIsoTimestamp(),
        },
      }
    );

    await logUserAccessEvent({
      userId: existing.id,
      staffId: existing.staffId,
      fullName: existing.fullName,
      eventType: "workforce_profile_updated",
      title: "Workforce profile updated",
      message: "Shift assignment, staff notes, or incident flags were updated.",
      actorName: String(actorName || "Owner").trim(),
      createdAt: currentIsoTimestamp(),
    });

    return () => getUserById(id);
  });
}

async function changeOwnUserPin(id, pinHash) {
  return enqueueWrite(async () => {
    const existing = getUserById(id);
    if (!existing) return null;

    const changedAt = currentIsoTimestamp();
    await models.User.updateOne(
      { id: Number(id) },
      {
        $set: {
          pinHash: String(pinHash || ""),
          pinStatus: "Assigned",
          pinUpdatedAt: changedAt,
          forcePinChange: false,
          updatedAt: changedAt,
        },
      }
    );

    await logUserAccessEvent({
      userId: existing.id,
      staffId: existing.staffId,
      fullName: existing.fullName,
      eventType: "pin_changed_self",
      title: "PIN changed by staff",
      message: "The staff member changed the temporary PIN and cleared first-login reset.",
      actorName: existing.fullName,
      createdAt: changedAt,
    });

    return () => getUserById(id);
  });
}

function getAllUserAccessEvents(limit = null) {
  assertInitialized();
  const normalizedLimit = Number(limit);
  if (!Number.isFinite(normalizedLimit) || normalizedLimit <= 0) {
    return clone(cache.userAccessEvents);
  }

  return clone(cache.userAccessEvents.slice(0, normalizedLimit));
}

async function deleteUser(id) {
  return enqueueWrite(async () => {
    const existing = getUserById(id);
    if (!existing) return null;
    const userId = Number(id);
    const updatedAt = currentIsoTimestamp();

    await Promise.all([
      models.Sale.updateMany(
        { cashierUserId: userId },
        {
          $set: {
            cashierUserId: null,
            updatedAt,
          },
        }
      ),
      models.AuditLog.updateMany(
        { actorUserId: userId },
        {
          $set: {
            actorUserId: null,
          },
        }
      ),
      models.User.deleteOne({ id: userId }),
      models.UserSession.deleteMany({ userId }),
      models.UserAccessEvent.deleteMany({ userId }),
      models.UserSavedView.deleteMany({ ownerUserId: userId }),
    ]);

    return existing;
  });
}

function getActiveUsers() {
  assertInitialized();
  return clone(cache.users.filter((user) => String(user.status || "").trim() === "Active"));
}

function getSales() {
  assertInitialized();
  return clone(cache.sales);
}

function getSaleById(id) {
  assertInitialized();
  const sale = cache.sales.find((item) => String(item.id) === String(id || "").trim());
  return sale ? clone(sale) : null;
}

function getNextSaleId() {
  assertInitialized();
  const max = currentMaxFromCache(cache.sales, (sale) => parseNumericFromId(sale.id, 0), 1000);
  return `SALE-${max + 1}`;
}

async function createSale(sale) {
  return enqueueWrite(async () =>
    executeWriteWithOptionalTransaction(async ({ session }) => {
      const saleId = String(sale.id || getNextSaleId()).trim();
      const createdAt = String(sale.createdAt || sale.date || currentIsoTimestamp());
      const updatedAt = String(sale.updatedAt || sale.date || createdAt);
      const customerName = compactLookupText(sale.customer, "Walk-in Customer");
      const customerId =
        sale.customerId === null || sale.customerId === undefined
          ? await ensureCustomerId(customerName, { session })
          : Number(sale.customerId);
      const cashierName = compactLookupText(sale.cashier, "Front Desk");
      const cashierUserId =
        sale.cashierUserId === null || sale.cashierUserId === undefined
          ? resolveUserIdByIdentity(cashierName)
          : Number(sale.cashierUserId);
      const normalizedStatus = String(sale.status || "Pending").trim() || "Pending";
      const saleItems = Array.isArray(sale.items) ? sale.items : [];

      const normalizedItems = saleItems.map((item) => {
        const product = cache.products.find((entry) => Number(entry.id) === Number(item.id));
        if (!product) {
          throw new Error(`Product not found for item ${item.name}.`);
        }

        return {
          id: Number(product.id),
          name: String(item.name || product.name || "").trim(),
          sku: String(item.sku || product.sku || "").trim(),
          qty: Number(item.qty || 0),
          price: Number(item.price || 0),
          unitCost: Number(item.unitCost || product.unitCost || 0),
          createdAt,
          updatedAt,
        };
      });

      const decremented = [];

      if (normalizedStatus === "Paid") {
        for (const item of normalizedItems) {
          const updatedProduct = await models.Product.findOneAndUpdate(
            {
              id: Number(item.id),
              stock: { $gte: Number(item.qty || 0) },
            },
            {
              $inc: { stock: -Number(item.qty || 0) },
              $set: { updatedAt },
            },
            { new: false, lean: true, session }
          );

          if (!updatedProduct) {
            throw new Error(`Insufficient stock for ${item.name}.`);
          }

          decremented.push({
            productId: Number(item.id),
            qty: Number(item.qty || 0),
            quantityBefore: Number(updatedProduct.stock || 0),
            product: updatedProduct,
          });
        }
      }

      await models.Sale.create(
        [
          {
            id: saleId,
            subtotal: Number(sale.subtotal || 0),
            tax: Number(sale.tax || 0),
            total: Number(sale.total || 0),
            cashierUserId:
              cashierUserId === null || cashierUserId === undefined ? null : Number(cashierUserId),
            cashier: cashierName,
            customerId,
            customer: customerName,
            status: normalizedStatus,
            channel: String(sale.channel || "In-Store").trim() || "In-Store",
            paymentMethod: String(sale.paymentMethod || "Card").trim() || "Card",
            date: String(sale.date || currentIsoTimestamp()),
            createdAt,
            updatedAt,
            items: normalizedItems,
          },
        ],
        { session }
      );

      await ensureCounterAtLeast(COUNTER_KEYS.sale, parseNumericFromId(saleId, 1000), {
        session,
      });

      if (normalizedStatus === "Paid") {
        for (const item of normalizedItems) {
          const decrementEntry = decremented.find(
            (entry) => Number(entry.productId) === Number(item.id)
          );
          const quantityBefore = Number(decrementEntry?.quantityBefore || 0);
          const quantityAfter = quantityBefore - Number(item.qty || 0);

          await insertInventoryMovementDoc(
            {
              productId: Number(item.id),
              productName: item.name,
              sku: item.sku,
              movementType: "sale",
              quantityDelta: -Number(item.qty || 0),
              quantityBefore,
              quantityAfter,
              referenceType: "sale",
              referenceId: saleId,
              note: `Sale recorded for ${String(item.name || "product").trim()}`,
              actorName: cashierName,
              createdAt: String(sale.date || createdAt),
            },
            {
              session,
              product: decrementEntry?.product || null,
            }
          );
        }
      }

      return () => getSaleById(saleId);
    })
  );
}

async function updateSaleStatus(id, nextStatus, options = {}) {
  return enqueueWrite(async () =>
    executeWriteWithOptionalTransaction(async ({ session }) => {
      const existing = getSaleById(id);
      if (!existing) return null;

      const currentStatus = String(existing.status || "Pending").trim();
      const normalizedNextStatus = String(nextStatus || currentStatus).trim();
      const nextUpdatedAt = String(options.updatedAt || currentIsoTimestamp());
      const actorName = String(options.actorName || existing.cashier || "Front Desk").trim();

      if (currentStatus === normalizedNextStatus) {
        return existing;
      }

      if (currentStatus !== "Paid" && normalizedNextStatus === "Paid") {
        for (const item of existing.items || []) {
          const updatedProduct = await models.Product.findOneAndUpdate(
            {
              id: Number(item.id),
              stock: { $gte: Number(item.qty || 0) },
            },
            {
              $inc: { stock: -Number(item.qty || 0) },
              $set: { updatedAt: nextUpdatedAt },
            },
            { new: false, lean: true, session }
          );

          if (!updatedProduct) {
            throw new Error(`Insufficient stock for ${item.name}.`);
          }

          const quantityBefore = Number(updatedProduct.stock || 0);
          const quantityAfter = quantityBefore - Number(item.qty || 0);

          await insertInventoryMovementDoc(
            {
              productId: Number(item.id),
              productName: item.name,
              sku: item.sku,
              movementType: "sale_capture",
              quantityDelta: -Number(item.qty || 0),
              quantityBefore,
              quantityAfter,
              referenceType: "sale",
              referenceId: String(existing.id || "").trim(),
              note: `Order completed for ${String(item.name || "product").trim()}`,
              actorName,
              createdAt: nextUpdatedAt,
            },
            {
              session,
              product: updatedProduct,
            }
          );
        }
      }

      if (currentStatus === "Paid" && normalizedNextStatus !== "Paid") {
        for (const item of existing.items || []) {
          const updatedProduct = await models.Product.findOneAndUpdate(
            { id: Number(item.id) },
            {
              $inc: { stock: Number(item.qty || 0) },
              $set: { updatedAt: nextUpdatedAt },
            },
            { new: false, lean: true, session }
          );

          if (!updatedProduct) {
            throw new Error(`Product not found for item ${item.name}.`);
          }

          const quantityBefore = Number(updatedProduct.stock || 0);
          const quantityAfter = quantityBefore + Number(item.qty || 0);

          await insertInventoryMovementDoc(
            {
              productId: Number(item.id),
              productName: item.name,
              sku: item.sku,
              movementType:
                normalizedNextStatus === "Refunded" ? "sale_refund" : "sale_reversal",
              quantityDelta: Number(item.qty || 0),
              quantityBefore,
              quantityAfter,
              referenceType: "sale",
              referenceId: String(existing.id || "").trim(),
              note:
                normalizedNextStatus === "Refunded"
                  ? `Order refunded for ${String(item.name || "product").trim()}`
                  : `Order reversed for ${String(item.name || "product").trim()}`,
              actorName,
              createdAt: nextUpdatedAt,
            },
            {
              session,
              product: updatedProduct,
            }
          );
        }
      }

      await models.Sale.updateOne(
        { id: String(existing.id || "").trim() },
        {
          $set: {
            status: normalizedNextStatus,
            updatedAt: nextUpdatedAt,
          },
        },
        { session }
      );

      return () => getSaleById(existing.id);
    })
  );
}

async function recordInventoryMovement(entry) {
  return enqueueWrite(async () => {
    const id = await insertInventoryMovementDoc(entry);
    return () => {
      const movement = cache.inventoryMovements.find((item) => Number(item.id) === Number(id));
      return movement ? clone(movement) : null;
    };
  });
}

function getRecentInventoryMovements(limit = 8) {
  assertInitialized();
  return clone(cache.inventoryMovements.slice(0, Number(limit || 8)));
}

function getProductMovements(productId, limit = 12) {
  assertInitialized();
  return clone(
    cache.inventoryMovements
      .filter((movement) => Number(movement.productId) === Number(productId))
      .slice(0, Number(limit || 12))
  );
}

function getAllInventoryMovements() {
  assertInitialized();
  return clone(cache.inventoryMovements);
}

function getPurchaseOrders(limit = 6) {
  assertInitialized();
  return clone(cache.purchaseOrders.slice(0, Number(limit || 6)));
}

function getAllPurchaseOrders() {
  assertInitialized();
  return clone(cache.purchaseOrders);
}

function getPurchaseOrderById(id) {
  assertInitialized();
  const order = cache.purchaseOrders.find((item) => String(item.id) === String(id || "").trim());
  return order ? clone(order) : null;
}

function getNextPurchaseOrderId() {
  assertInitialized();
  const max = currentMaxFromCache(
    cache.purchaseOrders,
    (item) => parseNumericFromId(item.id, 0),
    1000
  );
  return `PO-${max + 1}`;
}

async function createPurchaseOrder(order) {
  return enqueueWrite(async () => {
    const id = String(order.id || getNextPurchaseOrderId()).trim();
    const now = currentIsoTimestamp();
    const createdAt = String(order.createdAt || now);
    const updatedAt = String(order.updatedAt || createdAt);
    const supplier = compactLookupText(order.supplier, "General Supplier");
    const supplierId =
      order.supplierId === null || order.supplierId === undefined
        ? await ensureSupplierId(supplier)
        : Number(order.supplierId);
    const items = (Array.isArray(order.items) ? order.items : []).map((item, index) => ({
      id: Number(item.id || index + 1),
      productId: Number(item.productId),
      productName: String(item.productName || "").trim(),
      sku: String(item.sku || "").trim(),
      qtyOrdered: Number(item.qtyOrdered || 0),
      qtyReceived: Number(item.qtyReceived || 0),
      unitCost: Number(item.unitCost || 0),
      status:
        Number(item.qtyReceived || 0) >= Number(item.qtyOrdered || 0)
          ? "Received"
          : String(item.status || "Open").trim() || "Open",
      createdAt,
      updatedAt,
    }));

    const totalEstimatedCost = items.reduce(
      (sum, item) => sum + Number(item.qtyOrdered || 0) * Number(item.unitCost || 0),
      0
    );

    await models.PurchaseOrder.create({
      id,
      supplierId,
      supplier,
      status: String(order.status || "Draft").trim() || "Draft",
      note: String(order.note || "").trim(),
      createdBy: String(order.createdBy || "").trim(),
      createdAt,
      updatedAt,
      expectedDate: order.expectedDate ? String(order.expectedDate) : null,
      sentAt: order.sentAt ? String(order.sentAt) : null,
      receivedAt: order.receivedAt ? String(order.receivedAt) : null,
      totalEstimatedCost: Number(totalEstimatedCost || 0),
      items,
    });

    await ensureCounterAtLeast(COUNTER_KEYS.purchaseOrder, parseNumericFromId(id, 1000));
    return () => getPurchaseOrderById(id);
  });
}

async function updatePurchaseOrderStatus(id, status) {
  return enqueueWrite(async () => {
    const existing = getPurchaseOrderById(id);
    if (!existing) return null;

    const normalizedStatus = String(status || existing.status).trim() || existing.status;
    const sentAt =
      normalizedStatus === "Sent" && !existing.sentAt ? currentIsoTimestamp() : existing.sentAt;
    const updatedAt = currentIsoTimestamp();

    await models.PurchaseOrder.updateOne(
      { id: String(id || "").trim() },
      {
        $set: {
          status: normalizedStatus,
          sentAt: sentAt || null,
          updatedAt,
        },
      }
    );

    return () => getPurchaseOrderById(id);
  });
}

async function receivePurchaseOrder(id, receipt = {}) {
  return enqueueWrite(async () =>
    executeWriteWithOptionalTransaction(async ({ session }) => {
      const existing = getPurchaseOrderById(id);
      if (!existing) return null;

      if (["Cancelled", "Received"].includes(String(existing.status))) {
        throw new Error(`Purchase order ${existing.status.toLowerCase()} and cannot be received.`);
      }

      const explicitItems = Array.isArray(receipt.items) ? receipt.items : null;
      const receiptMap = (explicitItems || []).reduce((accumulator, item) => {
        accumulator[Number(item.productId)] = Number(item.qtyReceived || 0);
        return accumulator;
      }, {});
      const receivedAt = String(receipt.receivedAt || currentIsoTimestamp());
      const noteSuffix = String(receipt.note || "").trim();
      const actorName = String(receipt.actorName || "").trim();
      const nextItems = clone(existing.items || []);

      for (const item of nextItems) {
        const remaining = Math.max(0, Number(item.qtyOrdered || 0) - Number(item.qtyReceived || 0));
        const nextReceiveQty = explicitItems ? Number(receiptMap[item.productId] || 0) : remaining;

        if (nextReceiveQty < 0 || nextReceiveQty > remaining) {
          throw new Error(`Invalid receive quantity for ${item.productName}.`);
        }

        if (nextReceiveQty === 0) {
          continue;
        }

        const productBefore = cache.products.find(
          (entry) => Number(entry.id) === Number(item.productId)
        );

        if (!productBefore) {
          throw new Error(`Product not found for ${item.productName}.`);
        }

        await models.Product.updateOne(
          { id: Number(item.productId) },
          {
            $inc: { stock: Number(nextReceiveQty) },
            $set: {
              unitCost: Number(item.unitCost || productBefore.unitCost || 0),
              updatedAt: receivedAt,
            },
          },
          { session }
        );

        const quantityBefore = Number(productBefore.stock || 0);
        const quantityAfter = quantityBefore + Number(nextReceiveQty || 0);
        const newQtyReceived = Number(item.qtyReceived || 0) + Number(nextReceiveQty || 0);
        const newStatus = newQtyReceived >= Number(item.qtyOrdered || 0) ? "Received" : "Open";

        item.qtyReceived = newQtyReceived;
        item.status = newStatus;
        item.updatedAt = receivedAt;

        await insertInventoryMovementDoc(
          {
            productId: Number(item.productId),
            productName: item.productName,
            sku: item.sku,
            movementType: "purchase_receive",
            quantityDelta: Number(nextReceiveQty || 0),
            quantityBefore,
            quantityAfter,
            referenceType: "purchase_order",
            referenceId: String(existing.id),
            note: noteSuffix || `Received ${nextReceiveQty} units from ${existing.supplier}`,
            actorName,
            createdAt: receivedAt,
          },
          {
            session,
            product: productBefore,
          }
        );
      }

      const allReceived = nextItems.every(
        (item) => Number(item.qtyReceived || 0) >= Number(item.qtyOrdered || 0)
      );
      const anyReceived = nextItems.some((item) => Number(item.qtyReceived || 0) > 0);
      const nextStatus = allReceived
        ? "Received"
        : anyReceived
          ? "Partially Received"
          : existing.status;

      await models.PurchaseOrder.updateOne(
        { id: String(id || "").trim() },
        {
          $set: {
            items: nextItems,
            status: nextStatus,
            receivedAt: allReceived ? receivedAt : existing.receivedAt,
            sentAt: existing.sentAt || (nextStatus !== "Draft" ? receivedAt : null),
            updatedAt: receivedAt,
          },
        },
        { session }
      );

      return () => getPurchaseOrderById(id);
    })
  );
}

function getCycleCounts(limit = 5) {
  assertInitialized();
  return clone(cache.cycleCounts.slice(0, Number(limit || 5)));
}

function getAllCycleCounts() {
  assertInitialized();
  return clone(cache.cycleCounts);
}

function getCycleCountById(id) {
  assertInitialized();
  const count = cache.cycleCounts.find((item) => String(item.id) === String(id || "").trim());
  return count ? clone(count) : null;
}

function getNextCycleCountId() {
  assertInitialized();
  const max = currentMaxFromCache(cache.cycleCounts, (item) => parseNumericFromId(item.id, 0), 1000);
  return `CC-${max + 1}`;
}

async function createCycleCount(count) {
  return enqueueWrite(async () => {
    const id = String(count.id || getNextCycleCountId()).trim();
    const createdAt = String(count.createdAt || currentIsoTimestamp());
    const updatedAt = String(count.updatedAt || createdAt);
    const items = (Array.isArray(count.items) ? count.items : []).map((item, index) => ({
      id: Number(item.id || index + 1),
      productId: Number(item.productId),
      productName: String(item.productName || "").trim(),
      sku: String(item.sku || "").trim(),
      expectedQty: Number(item.expectedQty || 0),
      countedQty: item.countedQty === null || item.countedQty === undefined ? null : Number(item.countedQty),
      varianceQty: item.varianceQty === null || item.varianceQty === undefined ? null : Number(item.varianceQty),
      status: String(item.status || "Pending").trim() || "Pending",
      createdAt,
      updatedAt,
    }));

    await models.CycleCount.create({
      id,
      status: String(count.status || "Open").trim() || "Open",
      note: String(count.note || "").trim(),
      createdBy: String(count.createdBy || "").trim(),
      createdAt,
      updatedAt,
      completedAt: count.completedAt ? String(count.completedAt) : null,
      items,
    });

    await ensureCounterAtLeast(COUNTER_KEYS.cycleCount, parseNumericFromId(id, 1000));
    return () => getCycleCountById(id);
  });
}

async function completeCycleCount(id, submission = {}) {
  return enqueueWrite(async () =>
    executeWriteWithOptionalTransaction(async ({ session }) => {
      const existing = getCycleCountById(id);
      if (!existing) return null;
      if (String(existing.status) !== "Open") {
        throw new Error("Only open cycle counts can be completed.");
      }

      const submissionItems = Array.isArray(submission.items) ? submission.items : [];
      const submissionMap = submissionItems.reduce((accumulator, item) => {
        accumulator[Number(item.productId)] = Number(item.countedQty);
        return accumulator;
      }, {});
      const completedAt = String(submission.completedAt || currentIsoTimestamp());
      const actorName = String(submission.actorName || "").trim();
      const note = String(submission.note || "").trim();
      const nextItems = clone(existing.items || []);

      for (const item of nextItems) {
        const countedQty = submissionMap[item.productId];
        if (!Number.isFinite(countedQty) || countedQty < 0) {
          throw new Error(`A valid counted quantity is required for ${item.productName}.`);
        }

        const expectedQty = Number(item.expectedQty || 0);
        const varianceQty = Number(countedQty) - expectedQty;
        const nextStatus = varianceQty === 0 ? "Matched" : "Adjusted";

        item.countedQty = Number(countedQty);
        item.varianceQty = Number(varianceQty);
        item.status = nextStatus;
        item.updatedAt = completedAt;

        if (varianceQty !== 0) {
          const productBefore = cache.products.find(
            (entry) => Number(entry.id) === Number(item.productId)
          );

          if (!productBefore) {
            throw new Error(`Product not found for ${item.productName}.`);
          }

          await models.Product.updateOne(
            { id: Number(item.productId) },
            {
              $set: {
                stock: Number(countedQty),
                updatedAt: completedAt,
              },
            },
            { session }
          );

          await insertInventoryMovementDoc(
            {
              productId: Number(item.productId),
              productName: item.productName,
              sku: item.sku,
              movementType: "cycle_adjustment",
              quantityDelta: Number(varianceQty),
              quantityBefore: expectedQty,
              quantityAfter: Number(countedQty),
              referenceType: "cycle_count",
              referenceId: String(existing.id),
              note: note || `Cycle count variance applied for ${item.productName}`,
              actorName,
              createdAt: completedAt,
            },
            {
              session,
              product: productBefore,
            }
          );
        }
      }

      await models.CycleCount.updateOne(
        { id: String(id || "").trim() },
        {
          $set: {
            status: "Completed",
            completedAt,
            note: note || existing.note,
            updatedAt: completedAt,
            items: nextItems,
          },
        },
        { session }
      );

      return () => getCycleCountById(id);
    })
  );
}

function getAppSettings() {
  assertInitialized();
  return clone(cache.settings);
}

async function updateAppSettings(patch = {}) {
  return enqueueWrite(async () => {
    const nextSettings = normalizeSettingsPayload({
      ...getAppSettings(),
      ...(patch || {}),
    });

    await models.AppSetting.updateOne(
      { id: 1 },
      {
        $set: {
          id: 1,
          ...nextSettings,
          updatedAt: currentIsoTimestamp(),
        },
      },
      { upsert: true }
    );

    return () => getAppSettings();
  });
}

function getUserSavedViews(ownerUserId, pageKey = "users") {
  assertInitialized();
  const normalizedPageKey = String(pageKey || "users").trim() || "users";
  return clone(
    cache.userSavedViews
      .filter(
        (view) =>
          Number(view.ownerUserId) === Number(ownerUserId) &&
          String(view.pageKey || "").trim() === normalizedPageKey
      )
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
  );
}

function getAllUserSavedViews() {
  assertInitialized();
  return clone(cache.userSavedViews);
}

async function saveUserSavedView(ownerUserId, pageKey = "users", name = "", config = {}) {
  return enqueueWrite(async () => {
    const normalizedName = String(name || "").replace(/\s+/g, " ").trim();
    const normalizedPageKey = String(pageKey || "users").replace(/\s+/g, " ").trim() || "users";
    const now = currentIsoTimestamp();

    const existing = await models.UserSavedView.findOne({
      ownerUserId: Number(ownerUserId),
      pageKey: normalizedPageKey,
      name: normalizedName,
    }).lean();

    if (existing) {
      await models.UserSavedView.updateOne(
        { id: Number(existing.id) },
        {
          $set: {
            config: config && typeof config === "object" ? clone(config) : {},
            updatedAt: now,
          },
        }
      );
      return () =>
        getUserSavedViews(ownerUserId, normalizedPageKey).find(
          (view) => Number(view.id) === Number(existing.id)
        ) || null;
    }

    const id = await nextSequence(COUNTER_KEYS.userSavedView);
    await models.UserSavedView.create({
      id,
      ownerUserId: Number(ownerUserId),
      pageKey: normalizedPageKey,
      name: normalizedName,
      config: config && typeof config === "object" ? clone(config) : {},
      createdAt: now,
      updatedAt: now,
    });

    return () =>
      getUserSavedViews(ownerUserId, normalizedPageKey).find((view) => Number(view.id) === Number(id)) ||
      null;
  });
}

async function deleteUserSavedView(id, ownerUserId) {
  return enqueueWrite(async () => {
    const existing = await models.UserSavedView.findOne({
      id: Number(id),
      ownerUserId: Number(ownerUserId),
    }).lean();

    if (!existing) return null;

    await models.UserSavedView.deleteOne({
      id: Number(id),
      ownerUserId: Number(ownerUserId),
    });

    return {
      id: Number(existing.id),
      ownerUserId: Number(existing.ownerUserId || 0),
      pageKey: String(existing.pageKey || "").trim(),
      name: String(existing.name || "").trim(),
      config: existing.config && typeof existing.config === "object" ? clone(existing.config) : {},
      createdAt: String(existing.createdAt || currentIsoTimestamp()),
      updatedAt: String(existing.updatedAt || existing.createdAt || currentIsoTimestamp()),
    };
  });
}

async function insertAuditLog(entry = {}) {
  return enqueueWrite(async () => {
    const id = await nextSequence(COUNTER_KEYS.auditLog);
    await models.AuditLog.create({
      id,
      action: String(entry.action || "").trim(),
      entityType: String(entry.entityType || "").trim(),
      entityId: String(entry.entityId || "").trim(),
      actorUserId:
        entry.actorUserId === null || entry.actorUserId === undefined
          ? null
          : Number(entry.actorUserId),
      actorStaffId: String(entry.actorStaffId || "").trim(),
      actorName: String(entry.actorName || "").trim(),
      details: entry.details && typeof entry.details === "object" ? clone(entry.details) : {},
      createdAt: String(entry.createdAt || currentIsoTimestamp()),
    });
    return id;
  });
}

function getStorageInfo() {
  assertInitialized();
  return {
    engine: "mongo",
    databaseFile: null,
    counts: {
      roles: cache.roles.length,
      suppliers: cache.suppliers.length,
      customers: cache.customers.length,
      products: cache.products.length,
      users: cache.users.length,
      sales: cache.sales.length,
      purchaseOrders: cache.purchaseOrders.length,
      inventoryMovements: cache.inventoryMovements.length,
      cycleCounts: cache.cycleCounts.length,
      userAccessEvents: cache.userAccessEvents.length,
      userSavedViews: cache.userSavedViews.length,
      settingsProfiles: cache.settings ? 1 : 0,
      auditLogs: cache.auditLogsCount,
    },
  };
}

function getMongoDeploymentInfo() {
  return clone(mongoDeploymentInfo);
}

async function getBackupSnapshot() {
  assertInitialized();
  const auditLogs = await models.AuditLog.find({}).sort({ createdAt: -1, id: -1 }).lean();

  return {
    formatVersion: 2,
    generatedAt: currentIsoTimestamp(),
    storage: getStorageInfo(),
    settings: getAppSettings(),
    roles: getRoles(),
    suppliers: getSuppliers(),
    customers: getCustomers(),
    products: getProducts(),
    users: getUsers(),
    sales: getSales(),
    purchaseOrders: getAllPurchaseOrders(),
    inventoryMovements: getAllInventoryMovements(),
    cycleCounts: getAllCycleCounts(),
    userAccessEvents: getAllUserAccessEvents(),
    userSavedViews: getAllUserSavedViews(),
    auditLogs: auditLogs.map((row) => ({
      id: Number(row.id),
      action: String(row.action || "").trim(),
      entityType: String(row.entityType || "").trim(),
      entityId: String(row.entityId || "").trim(),
      actorUserId:
        row.actorUserId === null || row.actorUserId === undefined ? null : Number(row.actorUserId),
      actorStaffId: String(row.actorStaffId || "").trim(),
      actorName: String(row.actorName || "").trim(),
      details: row.details && typeof row.details === "object" ? clone(row.details) : {},
      createdAt: toIsoTimestamp(row.createdAt),
    })),
  };
}

module.exports = {
  databasePath: null,
  initialize,
  bootstrapSeedData,
  refreshCache,
  getRoles,
  getSuppliers,
  getSupplierById,
  findSupplierByName,
  getNextSupplierId,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getCustomers,
  getCustomerById,
  findCustomerByName,
  getNextCustomerId,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getProducts,
  getProductById,
  getNextProductId,
  findProductByName,
  findProductBySku,
  findProductByBarcode,
  createProduct,
  updateProduct,
  deleteProduct,
  restockProduct,
  restockProductWithMovement,
  getUsers,
  getUserById,
  getUserByStaffId,
  getUserAccessEvents,
  getAllUserAccessEvents,
  getUserOversight,
  getUserSessions,
  getUserSessionById,
  createUserSession,
  closeUserSession,
  touchUserSession,
  recordUserLoginFailure,
  countRecentLoginFailuresForStaffId,
  getNextUserId,
  createUser,
  updateUser,
  updateUserWorkforceProfile,
  assignUserPin,
  changeOwnUserPin,
  approveUserAccess,
  updateUserAccessStatus,
  deleteUser,
  getActiveUsers,
  getSales,
  getSaleById,
  getNextSaleId,
  createSale,
  updateSaleStatus,
  recordInventoryMovement,
  getRecentInventoryMovements,
  getProductMovements,
  getAllInventoryMovements,
  getPurchaseOrders,
  getAllPurchaseOrders,
  getPurchaseOrderById,
  getNextPurchaseOrderId,
  createPurchaseOrder,
  updatePurchaseOrderStatus,
  receivePurchaseOrder,
  getCycleCounts,
  getAllCycleCounts,
  getCycleCountById,
  getNextCycleCountId,
  createCycleCount,
  completeCycleCount,
  getAppSettings,
  updateAppSettings,
  getUserSavedViews,
  getAllUserSavedViews,
  saveUserSavedView,
  deleteUserSavedView,
  insertAuditLog,
  getStorageInfo,
  getMongoDeploymentInfo,
  getBackupSnapshot,
};
