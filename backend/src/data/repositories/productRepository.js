const models = require("../models");
const {
  getProductTaxProfile,
  normalizeStoredTaxClass,
} = require("../../tax/ontarioProductTax");
const {
  applySessionToQuery,
  buildExactCaseInsensitiveRegex,
  compactLookupText,
  currentIsoTimestamp,
  ensureCounterAtLeast,
  lookupKey,
  nextSequence,
  safeDate,
  toIsoTimestamp,
  withOptionalTransaction,
} = require("./mongoRepositoryUtils");

const COUNTER_KEYS = {
  inventoryMovement: "inventory_movement_id",
  product: "product_id",
  supplier: "supplier_id",
};

function normalizeProduct(row) {
  if (!row) return null;
  const taxProfile = getProductTaxProfile(row);

  return {
    id: Number(row.id),
    name: String(row.name || "").trim(),
    sku: String(row.sku || "").trim(),
    barcode: String(row.barcode || "").trim(),
    price: Number(row.price || 0),
    unitCost: Number(row.unitCost || 0),
    stock: Number(row.stock || 0),
    category: String(row.category || "General").trim() || "General",
    supplierId: row.supplierId === null || row.supplierId === undefined ? null : Number(row.supplierId),
    supplier: compactLookupText(row.supplier, "General Supplier"),
    ...taxProfile,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
  };
}

function normalizeInventoryMovement(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    productId: Number(row.productId || 0),
    productName: String(row.productName || "").trim(),
    sku: String(row.sku || "").trim(),
    movementType: String(row.movementType || "adjustment").trim() || "adjustment",
    quantityDelta: Number(row.quantityDelta || 0),
    quantityBefore:
      row.quantityBefore === null || row.quantityBefore === undefined
        ? null
        : Number(row.quantityBefore),
    quantityAfter:
      row.quantityAfter === null || row.quantityAfter === undefined
        ? null
        : Number(row.quantityAfter),
    referenceType: String(row.referenceType || "").trim(),
    referenceId: String(row.referenceId || "").trim(),
    note: String(row.note || "").trim(),
    actorName: String(row.actorName || "").trim(),
    createdAt: toIsoTimestamp(row.createdAt),
  };
}

async function loadProductDocument(id, session = null) {
  return applySessionToQuery(
    models.Product.findOne({ id: Number(id) }).lean(),
    session
  );
}

async function ensureSupplierId(name, { session = null } = {}) {
  const normalized = compactLookupText(name, "General Supplier");
  const existing = await applySessionToQuery(
    models.Supplier.findOne({
      name: buildExactCaseInsensitiveRegex(normalized),
    }).lean(),
    session
  );

  if (existing) {
    return Number(existing.id);
  }

  const now = new Date();
  const id = await nextSequence(COUNTER_KEYS.supplier, { session });

  await models.Supplier.create(
    [
      {
        id,
        name: normalized,
        contactName: "",
        email: "",
        phone: "",
        notes: "",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    { session }
  );

  return id;
}

async function insertInventoryMovementDoc(entry, { session = null, product = null } = {}) {
  const movementProduct =
    product || (await loadProductDocument(entry.productId, session));
  const id = await nextSequence(COUNTER_KEYS.inventoryMovement, { session });
  const createdAt = safeDate(entry.createdAt) || new Date();

  await models.InventoryMovement.create(
    [
      {
        id,
        productId: Number(entry.productId),
        productName: String(entry.productName || movementProduct?.name || "").trim(),
        sku: String(entry.sku || movementProduct?.sku || "").trim(),
        movementType: String(entry.movementType || "adjustment").trim() || "adjustment",
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

  const created = await applySessionToQuery(
    models.InventoryMovement.findOne({ id }).lean(),
    session
  );

  return normalizeInventoryMovement(created);
}

async function getProducts() {
  const rows = await models.Product.find({}).sort({ id: 1 }).lean();
  return rows.map(normalizeProduct);
}

async function getProductById(id) {
  const row = await loadProductDocument(id);
  return normalizeProduct(row);
}

async function getNextProductId() {
  const row = await models.Product.findOne({}).sort({ id: -1 }).select({ id: 1 }).lean();
  return Number(row?.id || 0) + 1;
}

async function findProductByName(name, excludeId = null) {
  const normalized = compactLookupText(name);
  if (!normalized) return null;

  const query = {
    name: buildExactCaseInsensitiveRegex(normalized),
  };

  if (excludeId !== null && excludeId !== undefined) {
    query.id = { $ne: Number(excludeId) };
  }

  const row = await models.Product.findOne(query).lean();
  return normalizeProduct(row);
}

async function findProductBySku(sku, excludeId = null) {
  const normalized = compactLookupText(sku);
  if (!normalized) return null;

  const query = {
    sku: buildExactCaseInsensitiveRegex(normalized),
  };

  if (excludeId !== null && excludeId !== undefined) {
    query.id = { $ne: Number(excludeId) };
  }

  const row = await models.Product.findOne(query).lean();
  return normalizeProduct(row);
}

async function findProductByBarcode(barcode, excludeId = null) {
  const normalized = compactLookupText(barcode);
  if (!normalized) return null;

  const query = {
    barcode: buildExactCaseInsensitiveRegex(normalized),
  };

  if (excludeId !== null && excludeId !== undefined) {
    query.id = { $ne: Number(excludeId) };
  }

  const row = await models.Product.findOne(query).lean();
  return normalizeProduct(row);
}

async function createProduct(product) {
  const hasExplicitId = product.id !== null && product.id !== undefined;
  const id = hasExplicitId ? Number(product.id) : await nextSequence(COUNTER_KEYS.product);
  const supplier = compactLookupText(product.supplier, "General Supplier");
  const supplierId =
    product.supplierId === null || product.supplierId === undefined
      ? await ensureSupplierId(supplier)
      : Number(product.supplierId);
  const now = safeDate(product.createdAt) || new Date();
  const updatedAt = safeDate(product.updatedAt) || now;
  const taxClass = normalizeStoredTaxClass(product.taxClass);

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
    ...(taxClass ? { taxClass } : {}),
    createdAt: now,
    updatedAt,
  });

  if (hasExplicitId) {
    await ensureCounterAtLeast(COUNTER_KEYS.product, id);
  }

  return getProductById(id);
}

async function updateProduct(id, product) {
  const existing = await getProductById(id);
  if (!existing) return null;

  const supplier = compactLookupText(product.supplier, "General Supplier");
  const supplierId =
    product.supplierId === null || product.supplierId === undefined
      ? await ensureSupplierId(supplier)
      : Number(product.supplierId);

  const taxClassProvided = Object.prototype.hasOwnProperty.call(product || {}, "taxClass");
  const normalizedTaxClass = normalizeStoredTaxClass(product.taxClass);
  const nextUpdatedAt = safeDate(product.updatedAt) || new Date();

  const update = {
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
      updatedAt: nextUpdatedAt,
    },
  };

  if (taxClassProvided) {
    if (normalizedTaxClass) {
      update.$set.taxClass = normalizedTaxClass;
    } else {
      update.$unset = { taxClass: "" };
    }
  }

  await models.Product.updateOne(
    { id: Number(id) },
    update
  );

  return getProductById(id);
}

async function deleteProduct(id) {
  const existing = await getProductById(id);
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
}

async function restockProduct(id, amount) {
  const now = new Date();

  await models.Product.updateOne(
    { id: Number(id) },
    {
      $inc: { stock: Number(amount || 0) },
      $set: { updatedAt: now },
    }
  );

  return getProductById(id);
}

async function restockProductWithMovement(id, amount, movement = {}) {
  return withOptionalTransaction(async ({ session }) => {
    const existingRow = await loadProductDocument(id, session);
    if (!existingRow) return null;

    const existing = normalizeProduct(existingRow);
    const restockAmount = Number(amount || 0);
    const changedAt = safeDate(movement.createdAt) || new Date();

    await models.Product.updateOne(
      { id: Number(existing.id) },
      {
        $inc: { stock: restockAmount },
        $set: { updatedAt: changedAt },
      },
      { session }
    );

    await insertInventoryMovementDoc(
      {
        productId: Number(existing.id),
        productName: existing.name,
        sku: existing.sku,
        movementType: String(movement.movementType || "restock").trim() || "restock",
        quantityDelta: restockAmount,
        quantityBefore: Number(existing.stock || 0),
        quantityAfter: Number(existing.stock || 0) + restockAmount,
        referenceType: String(movement.referenceType || "product").trim() || "product",
        referenceId: String(movement.referenceId || existing.id),
        note: String(movement.note || "").trim(),
        actorName: String(movement.actorName || "").trim(),
        createdAt: changedAt,
      },
      { session, product: existingRow }
    );

    const updated = await loadProductDocument(id, session);
    return normalizeProduct(updated);
  });
}

async function recordInventoryMovement(entry) {
  return insertInventoryMovementDoc(entry);
}

async function getRecentInventoryMovements(limit = 8) {
  const normalizedLimit = Number(limit);
  const rows = await models.InventoryMovement.find({})
    .sort({ createdAt: -1, id: -1 })
    .limit(Number.isFinite(normalizedLimit) && normalizedLimit > 0 ? normalizedLimit : 8)
    .lean();

  return rows.map(normalizeInventoryMovement);
}

async function getProductMovements(productId, limit = 12) {
  const normalizedLimit = Number(limit);
  const rows = await models.InventoryMovement.find({ productId: Number(productId) })
    .sort({ createdAt: -1, id: -1 })
    .limit(Number.isFinite(normalizedLimit) && normalizedLimit > 0 ? normalizedLimit : 12)
    .lean();

  return rows.map(normalizeInventoryMovement);
}

module.exports = {
  createProduct,
  deleteProduct,
  findProductByBarcode,
  findProductByName,
  findProductBySku,
  getNextProductId,
  getProductById,
  getProductMovements,
  getProducts,
  getRecentInventoryMovements,
  recordInventoryMovement,
  restockProduct,
  restockProductWithMovement,
  updateProduct,
};
