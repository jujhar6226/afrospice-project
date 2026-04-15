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

const COUNTER_KEY = "customer_id";

function normalizeCustomer(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    name: String(row.name || "").trim(),
    email: String(row.email || "").trim(),
    phone: String(row.phone || "").trim(),
    notes: String(row.notes || "").trim(),
    loyaltyOptIn: Boolean(row.loyaltyOptIn),
    marketingOptIn: Boolean(row.marketingOptIn),
    preferredContactMethod: String(row.preferredContactMethod || "None").trim() || "None",
    loyaltyEnrolledAt: toIsoTimestamp(row.loyaltyEnrolledAt),
    isWalkIn: Boolean(row.isWalkIn),
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
  };
}

async function loadCustomerDocument(id, session = null) {
  return applySessionToQuery(
    models.Customer.findOne({ id: Number(id) }).lean(),
    session
  );
}

async function getCustomers() {
  const rows = await models.Customer.find({}).sort({ name: 1 }).lean();
  return rows.map(normalizeCustomer);
}

async function getCustomerById(id) {
  const row = await loadCustomerDocument(id);
  return normalizeCustomer(row);
}

async function findCustomerByName(name, excludeId = null) {
  const normalized = compactLookupText(name);
  if (!normalized) return null;

  const query = {
    name: buildExactCaseInsensitiveRegex(normalized),
  };

  if (excludeId !== null && excludeId !== undefined) {
    query.id = { $ne: Number(excludeId) };
  }

  const row = await models.Customer.findOne(query).lean();
  return normalizeCustomer(row);
}

async function getNextCustomerId() {
  const row = await models.Customer.findOne({}).sort({ id: -1 }).select({ id: 1 }).lean();
  return Number(row?.id || 0) + 1;
}

async function createCustomer(customer) {
  const hasExplicitId = customer.id !== null && customer.id !== undefined;
  const id = hasExplicitId ? Number(customer.id) : await nextSequence(COUNTER_KEY);
  const createdAt = safeDate(customer.createdAt) || new Date();
  const updatedAt = safeDate(customer.updatedAt) || createdAt;

  await models.Customer.create({
    id,
    name: String(customer.name || "").trim(),
    email: String(customer.email || "").trim(),
    phone: String(customer.phone || "").trim(),
    notes: String(customer.notes || "").trim(),
    loyaltyOptIn: Boolean(customer.loyaltyOptIn),
    marketingOptIn: Boolean(customer.marketingOptIn),
    preferredContactMethod: String(customer.preferredContactMethod || "None").trim() || "None",
    loyaltyEnrolledAt: safeDate(customer.loyaltyEnrolledAt),
    isWalkIn: Boolean(customer.isWalkIn),
    createdAt,
    updatedAt,
  });

  if (hasExplicitId) {
    await ensureCounterAtLeast(COUNTER_KEY, id);
  }

  return getCustomerById(id);
}

async function updateCustomer(id, customer) {
  return withOptionalTransaction(async ({ session }) => {
    const existingRow = await loadCustomerDocument(id, session);
    if (!existingRow) return null;

    const existing = normalizeCustomer(existingRow);
    if (existing.isWalkIn) {
      throw new Error("Walk-in customer cannot be edited.");
    }

    const customerId = Number(id);
    const previousName = String(existing.name || "").trim();
    const nextName = String(customer.name || previousName).trim() || previousName;
    const updatedAt = safeDate(customer.updatedAt) || new Date();

    await models.Customer.updateOne(
      { id: customerId },
      {
        $set: {
          name: nextName,
          email: String(customer.email || "").trim(),
          phone: String(customer.phone || "").trim(),
          notes: String(customer.notes || "").trim(),
          loyaltyOptIn: Boolean(customer.loyaltyOptIn),
          marketingOptIn: Boolean(customer.marketingOptIn),
          preferredContactMethod: String(customer.preferredContactMethod || "None").trim() || "None",
          loyaltyEnrolledAt: safeDate(customer.loyaltyEnrolledAt),
          isWalkIn: Boolean(existing.isWalkIn),
          updatedAt,
        },
      },
      { session }
    );

    if (previousName.toLowerCase() !== nextName.toLowerCase()) {
      await applySessionToQuery(
        models.Sale.updateMany(
          {
            $or: [{ customerId }, { customer: buildExactCaseInsensitiveRegex(previousName) }],
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

    const updated = await loadCustomerDocument(id, session);
    return normalizeCustomer(updated);
  });
}

async function deleteCustomer(id) {
  return withOptionalTransaction(async ({ session }) => {
    const existingRow = await loadCustomerDocument(id, session);
    if (!existingRow) return null;

    const existing = normalizeCustomer(existingRow);
    if (existing.isWalkIn) {
      throw new Error("Walk-in customer cannot be deleted.");
    }

    const customerId = Number(id);
    const saleReference = await applySessionToQuery(
      models.Sale.findOne({
        $or: [{ customerId }, { customer: buildExactCaseInsensitiveRegex(existing.name) }],
      })
        .select({ id: 1 })
        .lean(),
      session
    );

    if (saleReference) {
      throw new Error("Customer is referenced by existing records.");
    }

    await models.Customer.deleteOne({ id: customerId }, { session });
    return existing;
  });
}

module.exports = {
  createCustomer,
  deleteCustomer,
  findCustomerByName,
  getCustomerById,
  getCustomers,
  getNextCustomerId,
  updateCustomer,
};
