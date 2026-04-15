const models = require("../models");
const {
  applySessionToQuery,
  buildExactCaseInsensitiveRegex,
  compactLookupText,
  ensureCounterAtLeast,
  nextSequence,
  safeDate,
  toIsoTimestamp,
  withOptionalTransaction,
} = require("./mongoRepositoryUtils");

const COUNTER_KEY = "supplier_id";

function normalizeSupplier(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    name: String(row.name || "").trim(),
    contactName: String(row.contactName || "").trim(),
    email: String(row.email || "").trim(),
    phone: String(row.phone || "").trim(),
    notes: String(row.notes || "").trim(),
    isActive: row.isActive === undefined ? true : Boolean(row.isActive),
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
  };
}

async function loadSupplierDocument(id, session = null) {
  return applySessionToQuery(
    models.Supplier.findOne({ id: Number(id) }).lean(),
    session
  );
}

async function getSuppliers() {
  const rows = await models.Supplier.find({}).sort({ name: 1 }).lean();
  return rows.map(normalizeSupplier);
}

async function getSupplierById(id) {
  const row = await loadSupplierDocument(id);
  return normalizeSupplier(row);
}

async function findSupplierByName(name, excludeId = null) {
  const normalized = compactLookupText(name);
  if (!normalized) return null;

  const query = {
    name: buildExactCaseInsensitiveRegex(normalized),
  };

  if (excludeId !== null && excludeId !== undefined) {
    query.id = { $ne: Number(excludeId) };
  }

  const row = await models.Supplier.findOne(query).lean();
  return normalizeSupplier(row);
}

async function getNextSupplierId() {
  const row = await models.Supplier.findOne({}).sort({ id: -1 }).select({ id: 1 }).lean();
  return Number(row?.id || 0) + 1;
}

async function createSupplier(supplier) {
  const hasExplicitId = supplier.id !== null && supplier.id !== undefined;
  const id = hasExplicitId ? Number(supplier.id) : await nextSequence(COUNTER_KEY);
  const createdAt = safeDate(supplier.createdAt) || new Date();
  const updatedAt = safeDate(supplier.updatedAt) || createdAt;

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
    await ensureCounterAtLeast(COUNTER_KEY, id);
  }

  return getSupplierById(id);
}

async function updateSupplier(id, supplier) {
  return withOptionalTransaction(async ({ session }) => {
    const existingRow = await loadSupplierDocument(id, session);
    if (!existingRow) return null;

    const existing = normalizeSupplier(existingRow);
    const supplierId = Number(id);
    const previousName = String(existing.name || "").trim();
    const nextName = String(supplier.name || previousName).trim() || previousName;
    const updatedAt = safeDate(supplier.updatedAt) || new Date();

    await models.Supplier.updateOne(
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
      },
      { session }
    );

    if (previousName.toLowerCase() !== nextName.toLowerCase()) {
      await Promise.all([
        applySessionToQuery(
          models.Product.updateMany(
            {
              $or: [{ supplierId }, { supplier: buildExactCaseInsensitiveRegex(previousName) }],
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
              $or: [{ supplierId }, { supplier: buildExactCaseInsensitiveRegex(previousName) }],
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

    const updated = await loadSupplierDocument(id, session);
    return normalizeSupplier(updated);
  });
}

async function deleteSupplier(id) {
  return withOptionalTransaction(async ({ session }) => {
    const existingRow = await loadSupplierDocument(id, session);
    if (!existingRow) return null;

    const existing = normalizeSupplier(existingRow);
    const supplierId = Number(id);

    const [productReference, orderReference] = await Promise.all([
      applySessionToQuery(
        models.Product.findOne({
          $or: [{ supplierId }, { supplier: buildExactCaseInsensitiveRegex(existing.name) }],
        })
          .select({ id: 1 })
          .lean(),
        session
      ),
      applySessionToQuery(
        models.PurchaseOrder.findOne({
          $or: [{ supplierId }, { supplier: buildExactCaseInsensitiveRegex(existing.name) }],
        })
          .select({ id: 1 })
          .lean(),
        session
      ),
    ]);

    if (productReference || orderReference) {
      throw new Error("Supplier is referenced by existing records.");
    }

    await models.Supplier.deleteOne({ id: supplierId }, { session });
    return existing;
  });
}

module.exports = {
  createSupplier,
  deleteSupplier,
  findSupplierByName,
  getNextSupplierId,
  getSupplierById,
  getSuppliers,
  updateSupplier,
};
