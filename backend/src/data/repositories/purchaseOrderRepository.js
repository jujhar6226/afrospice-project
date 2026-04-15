const models = require("../models");
const productRepository = require("./productRepository");
const {
  applySessionToQuery,
  buildExactCaseInsensitiveRegex,
  compactLookupText,
  ensureCounterAtLeast,
  nextSequence,
  parseNumericFromId,
  safeDate,
  toIsoTimestamp,
  toNullableIsoTimestamp,
  withOptionalTransaction,
} = require("./mongoRepositoryUtils");

const COUNTER_KEYS = {
  inventoryMovement: "inventory_movement_id",
  purchaseOrder: "purchase_order_id",
  supplier: "supplier_id",
};

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
    supplier: compactLookupText(row.supplier, "General Supplier"),
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

async function loadPurchaseOrderDocument(id, session = null) {
  return applySessionToQuery(
    models.PurchaseOrder.findOne({ id: String(id || "").trim() }).lean(),
    session
  );
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
}

async function buildNextPurchaseOrderId() {
  const rows = await models.PurchaseOrder.find({}).select({ id: 1 }).lean();
  const max = rows.reduce((highest, row) => Math.max(highest, parseNumericFromId(row?.id, 1000)), 1000);
  return `PO-${max + 1}`;
}

async function getPurchaseOrders(limit = 6) {
  const normalizedLimit = Number(limit);
  const rows = await models.PurchaseOrder.find({})
    .sort({ createdAt: -1, id: -1 })
    .limit(Number.isFinite(normalizedLimit) && normalizedLimit > 0 ? normalizedLimit : 6)
    .lean();

  return rows.map(normalizePurchaseOrder);
}

async function getPurchaseOrderById(id) {
  const row = await loadPurchaseOrderDocument(id);
  return normalizePurchaseOrder(row);
}

async function createPurchaseOrder(order) {
  const id = String(order.id || (await buildNextPurchaseOrderId())).trim();
  const createdAt = safeDate(order.createdAt) || new Date();
  const updatedAt = safeDate(order.updatedAt) || createdAt;
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
    expectedDate: safeDate(order.expectedDate),
    sentAt: safeDate(order.sentAt),
    receivedAt: safeDate(order.receivedAt),
    totalEstimatedCost: Number(totalEstimatedCost || 0),
    items,
  });

  await ensureCounterAtLeast(COUNTER_KEYS.purchaseOrder, parseNumericFromId(id, 1000));
  return getPurchaseOrderById(id);
}

async function updatePurchaseOrderStatus(id, status) {
  const existing = await getPurchaseOrderById(id);
  if (!existing) return null;

  const normalizedStatus = String(status || existing.status).trim() || existing.status;
  const sentAt =
    normalizedStatus === "Sent" && !existing.sentAt ? new Date() : safeDate(existing.sentAt);
  const updatedAt = new Date();

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

  return getPurchaseOrderById(id);
}

async function receivePurchaseOrder(id, receipt = {}) {
  return withOptionalTransaction(async ({ session }) => {
    const existingRow = await loadPurchaseOrderDocument(id, session);
    if (!existingRow) return null;

    const existing = normalizePurchaseOrder(existingRow);
    if (["Cancelled", "Received"].includes(String(existing.status))) {
      throw new Error(`Purchase order ${existing.status.toLowerCase()} and cannot be received.`);
    }

    const explicitItems = Array.isArray(receipt.items) ? receipt.items : null;
    const receiptMap = (explicitItems || []).reduce((accumulator, item) => {
      accumulator[Number(item.productId)] = Number(item.qtyReceived || 0);
      return accumulator;
    }, {});
    const receivedAt = safeDate(receipt.receivedAt) || new Date();
    const noteSuffix = String(receipt.note || "").trim();
    const actorName = String(receipt.actorName || "").trim();
    const nextItems = existing.items.map((item) => ({ ...item }));

    for (const item of nextItems) {
      const remaining = Math.max(0, Number(item.qtyOrdered || 0) - Number(item.qtyReceived || 0));
      const nextReceiveQty = explicitItems ? Number(receiptMap[item.productId] || 0) : remaining;

      if (nextReceiveQty < 0 || nextReceiveQty > remaining) {
        throw new Error(`Invalid receive quantity for ${item.productName}.`);
      }

      if (nextReceiveQty === 0) {
        continue;
      }

      const productBefore = await loadProductDocument(item.productId, session);
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
      item.updatedAt = receivedAt.toISOString();

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
          items: nextItems.map((item) => ({
            ...item,
            createdAt: safeDate(item.createdAt) || receivedAt,
            updatedAt: safeDate(item.updatedAt) || receivedAt,
          })),
          status: nextStatus,
          receivedAt: allReceived ? receivedAt : safeDate(existing.receivedAt),
          sentAt: safeDate(existing.sentAt) || (nextStatus !== "Draft" ? receivedAt : null),
          updatedAt: receivedAt,
        },
      },
      { session }
    );

    const updated = await loadPurchaseOrderDocument(id, session);
    return normalizePurchaseOrder(updated);
  });
}

module.exports = {
  createPurchaseOrder,
  getProductById: productRepository.getProductById,
  getPurchaseOrderById,
  getPurchaseOrders,
  receivePurchaseOrder,
  updatePurchaseOrderStatus,
};
