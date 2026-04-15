const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const store = require("../data/storeRuntime");
const models = require("../data/models");
const analyticsService = require("../services/analyticsService");
const auditLogService = require("../services/auditLogService");
const machineLearningService = require("../services/machineLearningService");
const { parseCsv } = require("./csv");

const COUNTER_KEYS = {
  supplier: "supplier_id",
  customer: "customer_id",
  product: "product_id",
  user: "user_id",
  sale: "sale_id",
  inventoryMovement: "inventory_movement_id",
  purchaseOrder: "purchase_order_id",
  cycleCount: "cycle_count_id",
};

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function ensureString(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeDate(value, fallback = new Date()) {
  if (!value) return new Date(fallback);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
}

function parseNumericFromId(value, fallback = 0) {
  const match = String(value || "").match(/(\d+)(?!.*\d)/);
  return match ? toNumber(match[1], fallback) : fallback;
}

async function nextSequence(key, session) {
  const now = new Date();
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
      session,
      lean: true,
    }
  );

  return Number(counter?.seq || 1);
}

function getDatasets(manifest = {}) {
  return manifest.datasets && typeof manifest.datasets === "object" ? manifest.datasets : manifest;
}

function resolveEntry(spec) {
  if (Array.isArray(spec)) {
    return { records: spec };
  }

  if (typeof spec === "string") {
    return { path: spec };
  }

  if (spec && typeof spec === "object") {
    return spec;
  }

  return null;
}

function loadRecordsFromFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, "utf8");

  if (extension === ".csv") {
    return parseCsv(content);
  }

  const parsed = JSON.parse(content);
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed.records)) {
    return parsed.records;
  }

  throw new Error(`Expected an array or { records: [] } in ${filePath}.`);
}

function loadDataset(baseDir, spec) {
  const resolved = resolveEntry(spec);
  if (!resolved) return [];

  if (Array.isArray(resolved.records)) {
    return resolved.records;
  }

  if (!resolved.path) {
    return [];
  }

  const filePath = path.isAbsolute(resolved.path)
    ? resolved.path
    : path.resolve(baseDir, resolved.path);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Import file not found: ${filePath}`);
  }

  return loadRecordsFromFile(filePath);
}

async function buildReferenceState(session) {
  const suppliers = await models.Supplier.find({}).lean().session(session);
  const customers = await models.Customer.find({}).lean().session(session);
  const products = await models.Product.find({}).lean().session(session);
  const users = await models.User.find({}).lean().session(session);

  return {
    suppliersById: new Map(suppliers.map((item) => [Number(item.id), item])),
    suppliersByName: new Map(suppliers.map((item) => [ensureString(item.name).toLowerCase(), item])),
    customersById: new Map(customers.map((item) => [Number(item.id), item])),
    customersByName: new Map(customers.map((item) => [ensureString(item.name).toLowerCase(), item])),
    productsById: new Map(products.map((item) => [Number(item.id), item])),
    productsBySku: new Map(products.map((item) => [ensureString(item.sku).toLowerCase(), item])),
    productsByName: new Map(products.map((item) => [ensureString(item.name).toLowerCase(), item])),
    usersById: new Map(users.map((item) => [Number(item.id), item])),
    usersByStaffId: new Map(users.map((item) => [ensureString(item.staffId).toLowerCase(), item])),
    usersByName: new Map(users.map((item) => [ensureString(item.fullName).toLowerCase(), item])),
  };
}

async function upsertByFilter(Model, filter, payload, session, stats) {
  const existing = await Model.findOne(filter).lean().session(session);
  if (existing) {
    await Model.updateOne({ _id: existing._id }, { $set: payload }, { session });
    stats.updated += 1;
    return { ...existing, ...payload, _id: existing._id };
  }

  const [created] = await Model.create([payload], { session });
  stats.inserted += 1;
  return typeof created?.toObject === "function" ? created.toObject() : payload;
}

function buildImportStats() {
  return {
    inserted: 0,
    updated: 0,
  };
}

async function importSuppliers(records, references, session) {
  const stats = buildImportStats();

  for (const raw of records) {
    const name = ensureString(raw.name);
    if (!name) {
      throw new Error("Supplier import requires name.");
    }

    const existingByName = references.suppliersByName.get(name.toLowerCase());
    const id =
      raw.id !== undefined && raw.id !== null && raw.id !== ""
        ? toNumber(raw.id)
        : existingByName?.id ?? (await nextSequence(COUNTER_KEYS.supplier, session));
    const createdAt = normalizeDate(raw.createdAt);
    const updatedAt = normalizeDate(raw.updatedAt, createdAt);

    const payload = {
      id,
      name,
      contactName: ensureString(raw.contactName),
      email: ensureString(raw.email),
      phone: ensureString(raw.phone),
      notes: ensureString(raw.notes),
      isActive: toBoolean(raw.isActive, true),
      createdAt,
      updatedAt,
    };

    const saved = await upsertByFilter(
      models.Supplier,
      existingByName ? { _id: existingByName._id } : { id },
      payload,
      session,
      stats
    );

    references.suppliersById.set(id, saved);
    references.suppliersByName.set(name.toLowerCase(), saved);
  }

  return stats;
}

async function importCustomers(records, references, session) {
  const stats = buildImportStats();

  for (const raw of records) {
    const name = ensureString(raw.name);
    if (!name) {
      throw new Error("Customer import requires name.");
    }

    const existingByName = references.customersByName.get(name.toLowerCase());
    const id =
      raw.id !== undefined && raw.id !== null && raw.id !== ""
        ? toNumber(raw.id)
        : existingByName?.id ?? (await nextSequence(COUNTER_KEYS.customer, session));
    const createdAt = normalizeDate(raw.createdAt);
    const updatedAt = normalizeDate(raw.updatedAt, createdAt);

    const payload = {
      id,
      name,
      email: ensureString(raw.email),
      phone: ensureString(raw.phone),
      notes: ensureString(raw.notes),
      isWalkIn: toBoolean(raw.isWalkIn, /^walk-in customer$/i.test(name)),
      createdAt,
      updatedAt,
    };

    const saved = await upsertByFilter(
      models.Customer,
      existingByName ? { _id: existingByName._id } : { id },
      payload,
      session,
      stats
    );

    references.customersById.set(id, saved);
    references.customersByName.set(name.toLowerCase(), saved);
  }

  return stats;
}

async function importProducts(records, references, session) {
  const stats = buildImportStats();

  for (const raw of records) {
    const name = ensureString(raw.name);
    const sku = ensureString(raw.sku);

    if (!name || !sku) {
      throw new Error("Product import requires name and sku.");
    }

    const existing =
      references.productsBySku.get(sku.toLowerCase()) ||
      references.productsByName.get(name.toLowerCase()) ||
      null;

    let supplier = null;
    if (raw.supplierId !== undefined && raw.supplierId !== null && raw.supplierId !== "") {
      supplier = references.suppliersById.get(toNumber(raw.supplierId)) || null;
    }
    if (!supplier && raw.supplier) {
      supplier = references.suppliersByName.get(ensureString(raw.supplier).toLowerCase()) || null;
    }

    const id =
      raw.id !== undefined && raw.id !== null && raw.id !== ""
        ? toNumber(raw.id)
        : existing?.id ?? (await nextSequence(COUNTER_KEYS.product, session));
    const createdAt = normalizeDate(raw.createdAt);
    const updatedAt = normalizeDate(raw.updatedAt, createdAt);

    const payload = {
      id,
      name,
      sku,
      barcode: ensureString(raw.barcode),
      price: toNumber(raw.price),
      unitCost: toNumber(raw.unitCost),
      stock: toNumber(raw.stock),
      category: ensureString(raw.category, "General") || "General",
      supplierId: supplier ? Number(supplier.id) : null,
      supplier: supplier ? ensureString(supplier.name) : ensureString(raw.supplier, "General Supplier") || "General Supplier",
      createdAt,
      updatedAt,
    };

    const saved = await upsertByFilter(
      models.Product,
      existing ? { _id: existing._id } : { id },
      payload,
      session,
      stats
    );

    references.productsById.set(id, saved);
    references.productsBySku.set(sku.toLowerCase(), saved);
    references.productsByName.set(name.toLowerCase(), saved);
  }

  return stats;
}

async function importUsers(records, references, session) {
  const stats = buildImportStats();

  for (const raw of records) {
    const staffId = ensureString(raw.staffId);
    const fullName = ensureString(raw.fullName);

    if (!staffId || !fullName) {
      throw new Error("User import requires staffId and fullName.");
    }

    const existing =
      references.usersByStaffId.get(staffId.toLowerCase()) ||
      references.usersByName.get(fullName.toLowerCase()) ||
      null;
    const id =
      raw.id !== undefined && raw.id !== null && raw.id !== ""
        ? toNumber(raw.id)
        : existing?.id ?? (await nextSequence(COUNTER_KEYS.user, session));
    const createdAt = normalizeDate(raw.createdAt);
    const updatedAt = normalizeDate(raw.updatedAt, createdAt);
    const explicitPinHash = ensureString(raw.pinHash);
    const importedPin = ensureString(raw.pin);
    const pinHash = explicitPinHash
      ? explicitPinHash
      : importedPin
        ? await bcrypt.hash(importedPin, 10)
        : "";

    const payload = {
      id,
      staffId,
      pinHash,
      fullName,
      role: ensureString(raw.role, "Cashier") || "Cashier",
      roleId:
        raw.roleId === undefined || raw.roleId === null || raw.roleId === ""
          ? null
          : toNumber(raw.roleId),
      department: ensureString(raw.department),
      email: ensureString(raw.email),
      phone: ensureString(raw.phone),
      status: ensureString(raw.status, "Active") || "Active",
      pinStatus:
        ensureString(raw.pinStatus, pinHash ? "Assigned" : "Not Set") ||
        (pinHash ? "Assigned" : "Not Set"),
      invitedAt: raw.invitedAt ? normalizeDate(raw.invitedAt) : null,
      approvedAt: raw.approvedAt ? normalizeDate(raw.approvedAt) : null,
      approvedBy: ensureString(raw.approvedBy),
      pinUpdatedAt:
        raw.pinUpdatedAt || pinHash ? normalizeDate(raw.pinUpdatedAt, updatedAt) : null,
      shiftAssignment: ensureString(raw.shiftAssignment, "Unassigned") || "Unassigned",
      staffNotes: ensureString(raw.staffNotes),
      incidentFlag: ensureString(raw.incidentFlag, "Clear") || "Clear",
      incidentNote: ensureString(raw.incidentNote),
      forcePinChange: toBoolean(raw.forcePinChange),
      isPinned: toBoolean(raw.isPinned),
      timetable: raw.timetable && typeof raw.timetable === "object" ? raw.timetable : undefined,
      createdAt,
      updatedAt,
    };

    const saved = await upsertByFilter(
      models.User,
      existing ? { _id: existing._id } : { id },
      payload,
      session,
      stats
    );

    references.usersById.set(id, saved);
    references.usersByStaffId.set(staffId.toLowerCase(), saved);
    references.usersByName.set(fullName.toLowerCase(), saved);
  }

  return stats;
}

function buildInventoryMovementFilter(raw, productId) {
  if (raw.id !== undefined && raw.id !== null && raw.id !== "") {
    return { id: toNumber(raw.id) };
  }

  const referenceType = ensureString(raw.referenceType);
  const referenceId = ensureString(raw.referenceId);
  const movementType = ensureString(raw.movementType, "adjustment") || "adjustment";

  if (referenceType && referenceId) {
    return {
      productId: Number(productId),
      referenceType,
      referenceId,
      movementType,
    };
  }

  const createdAt = normalizeDate(raw.createdAt);
  return {
    productId: Number(productId),
    movementType,
    quantityDelta: toNumber(raw.quantityDelta),
    createdAt,
  };
}

function resolveProductReference(raw, references) {
  if (raw.productId !== undefined && raw.productId !== null && raw.productId !== "") {
    const byId = references.productsById.get(toNumber(raw.productId));
    if (byId) return byId;
  }

  if (raw.id !== undefined && raw.id !== null && raw.id !== "") {
    const byId = references.productsById.get(toNumber(raw.id));
    if (byId) return byId;
  }

  if (raw.sku) {
    const bySku = references.productsBySku.get(ensureString(raw.sku).toLowerCase());
    if (bySku) return bySku;
  }

  if (raw.name || raw.productName) {
    const byName = references.productsByName.get(
      ensureString(raw.name || raw.productName).toLowerCase()
    );
    if (byName) return byName;
  }

  throw new Error(
    `Could not resolve product reference for ${JSON.stringify({
      productId: raw.productId,
      sku: raw.sku,
      name: raw.name || raw.productName,
    })}.`
  );
}

function resolveCustomerReference(raw, references) {
  if (raw.customerId !== undefined && raw.customerId !== null && raw.customerId !== "") {
    return references.customersById.get(toNumber(raw.customerId)) || null;
  }

  if (raw.customer) {
    return references.customersByName.get(ensureString(raw.customer).toLowerCase()) || null;
  }

  return null;
}

function resolveCashierReference(raw, references) {
  if (raw.cashierUserId !== undefined && raw.cashierUserId !== null && raw.cashierUserId !== "") {
    return references.usersById.get(toNumber(raw.cashierUserId)) || null;
  }

  if (raw.staffId) {
    return references.usersByStaffId.get(ensureString(raw.staffId).toLowerCase()) || null;
  }

  if (raw.cashier) {
    return references.usersByName.get(ensureString(raw.cashier).toLowerCase()) || null;
  }

  return null;
}

function normalizeSaleItems(rawItems, references, baseDate) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (!items.length) {
    throw new Error("Sale import requires at least one item.");
  }

  return items.map((item, index) => {
    const product = resolveProductReference(item, references);
    const qty = Math.max(0, toNumber(item.qty, item.quantity));
    if (qty <= 0) {
      throw new Error(`Sale item ${index + 1} requires qty greater than zero.`);
    }

    const price = toNumber(item.price, product.price);
    const unitCost = toNumber(item.unitCost, product.unitCost);
    const createdAt = normalizeDate(item.createdAt, baseDate);
    const updatedAt = normalizeDate(item.updatedAt, createdAt);

    return {
      id: Number(product.id),
      name: ensureString(item.name, product.name) || product.name,
      sku: ensureString(item.sku, product.sku) || product.sku,
      qty,
      price,
      unitCost,
      createdAt,
      updatedAt,
    };
  });
}

async function importSales(records, references, session) {
  const stats = buildImportStats();

  for (const raw of records) {
    const saleDate = normalizeDate(raw.date || raw.createdAt);
    const createdAt = normalizeDate(raw.createdAt, saleDate);
    const updatedAt = normalizeDate(raw.updatedAt, createdAt);
    const items = normalizeSaleItems(raw.items, references, createdAt);
    const subtotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);
    const tax = toNumber(raw.tax);
    const total = toNumber(raw.total, subtotal + tax);
    const customer = resolveCustomerReference(raw, references);
    const cashier = resolveCashierReference(raw, references);
    const id =
      ensureString(raw.id) ||
      `SALE-${await nextSequence(COUNTER_KEYS.sale, session)}`;

    const payload = {
      id,
      subtotal,
      tax,
      total,
      cashierUserId: cashier ? Number(cashier.id) : null,
      cashier: cashier ? ensureString(cashier.fullName) : ensureString(raw.cashier, "Front Desk") || "Front Desk",
      customerId: customer ? Number(customer.id) : null,
      customer: customer ? ensureString(customer.name) : ensureString(raw.customer, "Walk-in Customer") || "Walk-in Customer",
      status: ensureString(raw.status, "Paid") || "Paid",
      channel: ensureString(raw.channel, "In-Store") || "In-Store",
      paymentMethod: ensureString(raw.paymentMethod, "Card") || "Card",
      date: saleDate,
      createdAt,
      updatedAt,
      items,
    };

    await upsertByFilter(models.Sale, { id }, payload, session, stats);
  }

  return stats;
}

function normalizePurchaseOrderItems(rawItems, references, baseDate) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (!items.length) {
    throw new Error("Purchase order import requires at least one item.");
  }

  return items.map((item, index) => {
    const product = resolveProductReference(item, references);
    const qtyOrdered = Math.max(0, toNumber(item.qtyOrdered, item.qty));
    if (qtyOrdered <= 0) {
      throw new Error(`Purchase order item ${index + 1} requires qtyOrdered greater than zero.`);
    }

    const qtyReceived = Math.max(0, toNumber(item.qtyReceived));
    const createdAt = normalizeDate(item.createdAt, baseDate);
    const updatedAt = normalizeDate(item.updatedAt, createdAt);

    return {
      id: item.id !== undefined && item.id !== null && item.id !== "" ? toNumber(item.id) : index + 1,
      productId: Number(product.id),
      productName: ensureString(item.productName, product.name) || product.name,
      sku: ensureString(item.sku, product.sku) || product.sku,
      qtyOrdered,
      qtyReceived,
      unitCost: toNumber(item.unitCost, product.unitCost),
      status: ensureString(item.status, qtyReceived >= qtyOrdered ? "Received" : "Open") || "Open",
      createdAt,
      updatedAt,
    };
  });
}

async function importPurchaseOrders(records, references, session) {
  const stats = buildImportStats();

  for (const raw of records) {
    const supplier =
      (raw.supplierId !== undefined && raw.supplierId !== null && raw.supplierId !== ""
        ? references.suppliersById.get(toNumber(raw.supplierId))
        : null) ||
      (raw.supplier ? references.suppliersByName.get(ensureString(raw.supplier).toLowerCase()) : null);

    if (!supplier && !raw.supplier) {
      throw new Error("Purchase order import requires supplier or supplierId.");
    }

    const createdAt = normalizeDate(raw.createdAt);
    const updatedAt = normalizeDate(raw.updatedAt, createdAt);
    const items = normalizePurchaseOrderItems(raw.items, references, createdAt);
    const id =
      ensureString(raw.id) ||
      `PO-${await nextSequence(COUNTER_KEYS.purchaseOrder, session)}`;

    const payload = {
      id,
      supplierId: supplier ? Number(supplier.id) : null,
      supplier: supplier ? ensureString(supplier.name) : ensureString(raw.supplier),
      status: ensureString(raw.status, "Draft") || "Draft",
      note: ensureString(raw.note),
      createdBy: ensureString(raw.createdBy),
      createdAt,
      updatedAt,
      expectedDate: raw.expectedDate ? normalizeDate(raw.expectedDate, createdAt) : null,
      sentAt: raw.sentAt ? normalizeDate(raw.sentAt, createdAt) : null,
      receivedAt: raw.receivedAt ? normalizeDate(raw.receivedAt, updatedAt) : null,
      totalEstimatedCost: toNumber(
        raw.totalEstimatedCost,
        items.reduce((sum, item) => sum + item.qtyOrdered * item.unitCost, 0)
      ),
      items,
    };

    await upsertByFilter(models.PurchaseOrder, { id }, payload, session, stats);
  }

  return stats;
}

function normalizeCycleCountItems(rawItems, references, baseDate) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (!items.length) {
    throw new Error("Cycle count import requires at least one item.");
  }

  return items.map((item, index) => {
    const product = resolveProductReference(item, references);
    const expectedQty = toNumber(item.expectedQty, product.stock);
    const countedQty =
      item.countedQty === undefined || item.countedQty === null || item.countedQty === ""
        ? null
        : toNumber(item.countedQty);
    const varianceQty =
      item.varianceQty === undefined || item.varianceQty === null || item.varianceQty === ""
        ? countedQty === null
          ? null
          : countedQty - expectedQty
        : toNumber(item.varianceQty);
    const createdAt = normalizeDate(item.createdAt, baseDate);
    const updatedAt = normalizeDate(item.updatedAt, createdAt);

    return {
      id: item.id !== undefined && item.id !== null && item.id !== "" ? toNumber(item.id) : index + 1,
      productId: Number(product.id),
      productName: ensureString(item.productName, product.name) || product.name,
      sku: ensureString(item.sku, product.sku) || product.sku,
      expectedQty,
      countedQty,
      varianceQty,
      status:
        ensureString(
          item.status,
          countedQty === null ? "Pending" : varianceQty === 0 ? "Matched" : "Variance"
        ) || "Pending",
      createdAt,
      updatedAt,
    };
  });
}

async function importCycleCounts(records, references, session) {
  const stats = buildImportStats();

  for (const raw of records) {
    const createdAt = normalizeDate(raw.createdAt);
    const updatedAt = normalizeDate(raw.updatedAt, createdAt);
    const items = normalizeCycleCountItems(raw.items, references, createdAt);
    const id =
      ensureString(raw.id) ||
      `CC-${await nextSequence(COUNTER_KEYS.cycleCount, session)}`;

    const payload = {
      id,
      status: ensureString(raw.status, "Open") || "Open",
      note: ensureString(raw.note),
      createdBy: ensureString(raw.createdBy),
      createdAt,
      updatedAt,
      completedAt: raw.completedAt ? normalizeDate(raw.completedAt, updatedAt) : null,
      items,
    };

    await upsertByFilter(models.CycleCount, { id }, payload, session, stats);
  }

  return stats;
}

async function importInventoryMovements(records, references, session) {
  const stats = buildImportStats();

  for (const raw of records) {
    const product = resolveProductReference(raw, references);
    const filter = buildInventoryMovementFilter(raw, product.id);
    const existing =
      raw.id !== undefined && raw.id !== null && raw.id !== ""
        ? null
        : await models.InventoryMovement.findOne(filter).lean().session(session);
    const id =
      raw.id !== undefined && raw.id !== null && raw.id !== ""
        ? toNumber(raw.id)
        : existing?.id ?? (await nextSequence(COUNTER_KEYS.inventoryMovement, session));

    const payload = {
      id,
      productId: Number(product.id),
      productName: ensureString(raw.productName, product.name) || product.name,
      sku: ensureString(raw.sku, product.sku) || product.sku,
      movementType: ensureString(raw.movementType, "adjustment") || "adjustment",
      quantityDelta: toNumber(raw.quantityDelta),
      quantityBefore:
        raw.quantityBefore === undefined || raw.quantityBefore === null || raw.quantityBefore === ""
          ? null
          : toNumber(raw.quantityBefore),
      quantityAfter:
        raw.quantityAfter === undefined || raw.quantityAfter === null || raw.quantityAfter === ""
          ? null
          : toNumber(raw.quantityAfter),
      referenceType: ensureString(raw.referenceType),
      referenceId: ensureString(raw.referenceId),
      note: ensureString(raw.note),
      actorName: ensureString(raw.actorName),
      createdAt: normalizeDate(raw.createdAt),
    };

    await upsertByFilter(models.InventoryMovement, filter, payload, session, stats);
  }

  return stats;
}

async function deriveInventoryMovements({ sales, purchaseOrders, cycleCounts }, references, session) {
  const movementMap = new Map();

  function registerMovement(partial) {
    const key = [
      Number(partial.productId),
      ensureString(partial.referenceType),
      ensureString(partial.referenceId),
      ensureString(partial.movementType),
    ].join("|");

    const existing = movementMap.get(key);
    if (existing) {
      existing.quantityDelta += toNumber(partial.quantityDelta);
      if (partial.createdAt && partial.createdAt < existing.createdAt) {
        existing.createdAt = partial.createdAt;
      }
      if (!existing.actorName && partial.actorName) {
        existing.actorName = partial.actorName;
      }
      return;
    }

    movementMap.set(key, {
      ...partial,
      quantityDelta: toNumber(partial.quantityDelta),
    });
  }

  for (const sale of sales) {
    if (String(sale.status || "").trim() !== "Paid") {
      continue;
    }

    for (const item of sale.items || []) {
      const product = resolveProductReference(item, references);
      registerMovement({
        productId: Number(product.id),
        productName: ensureString(product.name),
        sku: ensureString(product.sku),
        movementType: "sale",
        quantityDelta: -Math.abs(toNumber(item.qty)),
        quantityBefore: null,
        quantityAfter: null,
        referenceType: "sale",
        referenceId: ensureString(sale.id),
        note: "Derived historical sale movement.",
        actorName: ensureString(sale.cashier),
        createdAt: normalizeDate(sale.date || sale.createdAt),
      });
    }
  }

  for (const order of purchaseOrders) {
    const receivedAt = order.receivedAt || order.updatedAt;
    for (const item of order.items || []) {
      const qtyReceived = Math.max(0, toNumber(item.qtyReceived));
      if (qtyReceived <= 0) continue;
      const product = resolveProductReference(item, references);
      registerMovement({
        productId: Number(product.id),
        productName: ensureString(product.name),
        sku: ensureString(product.sku),
        movementType: "purchase_receive",
        quantityDelta: qtyReceived,
        quantityBefore: null,
        quantityAfter: null,
        referenceType: "purchaseOrder",
        referenceId: ensureString(order.id),
        note: "Derived historical purchase receipt movement.",
        actorName: ensureString(order.createdBy),
        createdAt: normalizeDate(receivedAt || order.createdAt),
      });
    }
  }

  for (const count of cycleCounts) {
    for (const item of count.items || []) {
      const varianceQty = toNumber(item.varianceQty);
      if (!varianceQty) continue;
      const product = resolveProductReference(item, references);
      registerMovement({
        productId: Number(product.id),
        productName: ensureString(product.name),
        sku: ensureString(product.sku),
        movementType: "cycle_adjustment",
        quantityDelta: varianceQty,
        quantityBefore: null,
        quantityAfter: null,
        referenceType: "cycleCount",
        referenceId: ensureString(count.id),
        note: "Derived historical cycle-count adjustment.",
        actorName: ensureString(count.createdBy),
        createdAt: normalizeDate(count.completedAt || count.updatedAt || count.createdAt),
      });
    }
  }

  const derived = [];
  for (const movement of movementMap.values()) {
    derived.push({
      ...movement,
      id: await nextSequence(COUNTER_KEYS.inventoryMovement, session),
    });
  }

  return derived;
}

async function summarizeMlFoundation() {
  const context = await analyticsService.getAnalyticsContextAsync();
  const model = machineLearningService.getOperationalModelOutputs(
    { range: "daily", horizon: 14, limit: 6 },
    context
  );

  return {
    engine: model.engine,
    dataFoundation: model.dataFoundation || null,
    modelSummary: model.modelSummary || null,
  };
}

async function importHistoricalData({ manifestPath, dryRun = false } = {}) {
  if (!manifestPath) {
    throw new Error("Historical import requires a manifest path.");
  }

  const resolvedManifestPath = path.resolve(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(resolvedManifestPath, "utf8"));
  const datasets = getDatasets(manifest);
  const baseDir = path.dirname(resolvedManifestPath);
  const options = {
    deriveInventoryMovements: toBoolean(manifest.options?.deriveInventoryMovements, true),
  };

  await store.initialize();

  const loaded = {
    suppliers: loadDataset(baseDir, datasets.suppliers),
    customers: loadDataset(baseDir, datasets.customers),
    products: loadDataset(baseDir, datasets.products),
    users: loadDataset(baseDir, datasets.users),
    sales: loadDataset(baseDir, datasets.sales),
    purchaseOrders: loadDataset(baseDir, datasets.purchaseOrders),
    inventoryMovements: loadDataset(baseDir, datasets.inventoryMovements),
    cycleCounts: loadDataset(baseDir, datasets.cycleCounts),
  };

  const session = await models.Counter.startSession();
  const summary = {
    dryRun,
    manifestPath: resolvedManifestPath,
    loadedCounts: Object.fromEntries(
      Object.entries(loaded).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])
    ),
    imported: {},
    derived: {
      inventoryMovements: 0,
    },
  };

  try {
    session.startTransaction();
    const references = await buildReferenceState(session);

    summary.imported.suppliers = await importSuppliers(loaded.suppliers, references, session);
    summary.imported.customers = await importCustomers(loaded.customers, references, session);
    summary.imported.products = await importProducts(loaded.products, references, session);
    summary.imported.users = await importUsers(loaded.users, references, session);
    summary.imported.sales = await importSales(loaded.sales, references, session);
    summary.imported.purchaseOrders = await importPurchaseOrders(
      loaded.purchaseOrders,
      references,
      session
    );
    summary.imported.cycleCounts = await importCycleCounts(loaded.cycleCounts, references, session);

    let movementRecords = loaded.inventoryMovements;
    if (!movementRecords.length && options.deriveInventoryMovements) {
      movementRecords = await deriveInventoryMovements(
        {
          sales: loaded.sales,
          purchaseOrders: loaded.purchaseOrders,
          cycleCounts: loaded.cycleCounts,
        },
        references,
        session
      );
      summary.derived.inventoryMovements = movementRecords.length;
    }

    summary.imported.inventoryMovements = await importInventoryMovements(
      movementRecords,
      references,
      session
    );

    if (dryRun) {
      await session.abortTransaction();
      summary.mlFoundation = null;
      return summary;
    }

    await session.commitTransaction();
  } catch (error) {
    try {
      await session.abortTransaction();
    } catch {}
    throw error;
  } finally {
    await session.endSession();
  }

  await store.refreshCache();
  summary.mlFoundation = await summarizeMlFoundation();
  await auditLogService.recordAuditEvent({
    actor: {
      staffId: "SYSTEM-IMPORT",
      fullName: "Historical Import Pipeline",
    },
    action: "system.historical_import",
    entityType: "system",
    entityId: "historical-import",
    details: {
      manifestFile: path.basename(resolvedManifestPath),
      loadedCounts: summary.loadedCounts,
      imported: summary.imported,
      derived: summary.derived,
      dryRun: summary.dryRun,
      mlFoundation: summary.mlFoundation,
    },
  });
  summary.auditLogged = true;

  return summary;
}

module.exports = {
  importHistoricalData,
};
