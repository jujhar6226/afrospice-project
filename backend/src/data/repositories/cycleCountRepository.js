const models = require("../models");
const productRepository = require("./productRepository");
const {
  applySessionToQuery,
  ensureCounterAtLeast,
  nextSequence,
  parseNumericFromId,
  safeDate,
  toIsoTimestamp,
  toNullableIsoTimestamp,
  withOptionalTransaction,
} = require("./mongoRepositoryUtils");

const COUNTER_KEYS = {
  cycleCount: "cycle_count_id",
  inventoryMovement: "inventory_movement_id",
};

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

async function loadCycleCountDocument(id, session = null) {
  return applySessionToQuery(
    models.CycleCount.findOne({ id: String(id || "").trim() }).lean(),
    session
  );
}

async function loadProductDocument(id, session = null) {
  return applySessionToQuery(
    models.Product.findOne({ id: Number(id) }).lean(),
    session
  );
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

async function buildNextCycleCountId() {
  const rows = await models.CycleCount.find({}).select({ id: 1 }).lean();
  const max = rows.reduce((highest, row) => Math.max(highest, parseNumericFromId(row?.id, 1000)), 1000);
  return `CC-${max + 1}`;
}

async function getCycleCounts(limit = 5) {
  const normalizedLimit = Number(limit);
  const rows = await models.CycleCount.find({})
    .sort({ createdAt: -1, id: -1 })
    .limit(Number.isFinite(normalizedLimit) && normalizedLimit > 0 ? normalizedLimit : 5)
    .lean();

  return rows.map(normalizeCycleCount);
}

async function getCycleCountById(id) {
  const row = await loadCycleCountDocument(id);
  return normalizeCycleCount(row);
}

async function createCycleCount(count) {
  const id = String(count.id || (await buildNextCycleCountId())).trim();
  const createdAt = safeDate(count.createdAt) || new Date();
  const updatedAt = safeDate(count.updatedAt) || createdAt;
  const items = (Array.isArray(count.items) ? count.items : []).map((item, index) => ({
    id: Number(item.id || index + 1),
    productId: Number(item.productId),
    productName: String(item.productName || "").trim(),
    sku: String(item.sku || "").trim(),
    expectedQty: Number(item.expectedQty || 0),
    countedQty:
      item.countedQty === null || item.countedQty === undefined ? null : Number(item.countedQty),
    varianceQty:
      item.varianceQty === null || item.varianceQty === undefined ? null : Number(item.varianceQty),
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
    completedAt: safeDate(count.completedAt),
    items,
  });

  await ensureCounterAtLeast(COUNTER_KEYS.cycleCount, parseNumericFromId(id, 1000));
  return getCycleCountById(id);
}

async function completeCycleCount(id, submission = {}) {
  return withOptionalTransaction(async ({ session }) => {
    const existingRow = await loadCycleCountDocument(id, session);
    if (!existingRow) return null;

    const existing = normalizeCycleCount(existingRow);
    if (String(existing.status) !== "Open") {
      throw new Error("Only open cycle counts can be completed.");
    }

    const submissionItems = Array.isArray(submission.items) ? submission.items : [];
    const submissionMap = submissionItems.reduce((accumulator, item) => {
      accumulator[Number(item.productId)] = Number(item.countedQty);
      return accumulator;
    }, {});
    const completedAt = safeDate(submission.completedAt) || new Date();
    const actorName = String(submission.actorName || "").trim();
    const note = String(submission.note || "").trim();
    const nextItems = existing.items.map((item) => ({ ...item }));

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
      item.updatedAt = completedAt.toISOString();

      if (varianceQty !== 0) {
        const productBefore = await loadProductDocument(item.productId, session);
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
          items: nextItems.map((item) => ({
            ...item,
            createdAt: safeDate(item.createdAt) || completedAt,
            updatedAt: safeDate(item.updatedAt) || completedAt,
          })),
        },
      },
      { session }
    );

    const updated = await loadCycleCountDocument(id, session);
    return normalizeCycleCount(updated);
  });
}

module.exports = {
  completeCycleCount,
  createCycleCount,
  getCycleCountById,
  getCycleCounts,
  getProductById: productRepository.getProductById,
};
