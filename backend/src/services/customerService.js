const AppError = require("../errors/AppError");
const customerRepository = require("../data/repositories/customerRepository");
const salesRepository = require("../data/repositories/salesRepository");
const settingsRepository = require("../data/repositories/settingsRepository");
const auditLogService = require("./auditLogService");
const {
  validateCustomerListQuery,
  validateCustomerPayload,
} = require("../validation/customerValidators");
const { assertCondition } = require("../validation/helpers");

const VIP_ORDER_THRESHOLD = 6;
const VIP_SPEND_THRESHOLD = 350;

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function buildCustomerNumber(customer) {
  return `AFR-CUS-${String(Math.max(0, Number(customer?.id || 0))).padStart(4, "0")}`;
}

function buildLoyaltyCardNumber(customer, settings = {}) {
  const numericId = Math.max(0, Number(customer?.id || 0));
  const branchToken = String(settings?.branchCode || "AFR")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 8);

  return `${branchToken || "AFR"}-LOY-${String(numericId).padStart(6, "0")}`;
}

function matchesCustomerSale(customer, sale) {
  if (!customer || !sale) return false;

  if (sale.customerId !== null && sale.customerId !== undefined) {
    return Number(sale.customerId) === Number(customer.id);
  }

  return String(sale.customer || "").trim().toLowerCase() === String(customer.name || "").trim().toLowerCase();
}

function determineCustomerStatus(lastPurchaseAt) {
  if (!lastPurchaseAt) return { label: "New", tone: "neutral" };

  const diffInDays = Math.floor((Date.now() - new Date(lastPurchaseAt).getTime()) / 86400000);
  if (!Number.isFinite(diffInDays) || diffInDays < 0) {
    return { label: "Active", tone: "success" };
  }

  if (diffInDays >= 90) return { label: "Dormant", tone: "danger" };
  if (diffInDays >= 45) return { label: "Cooling", tone: "warning" };
  return { label: "Active", tone: "success" };
}

function determineLoyaltyProfile(customer, settings, summary) {
  const defaultDiscountPct = toFiniteNumber(settings?.defaultCustomerDiscountPct, 5);
  const vipDiscountPct = toFiniteNumber(settings?.vipCustomerDiscountPct, 10);
  const discountsEnabled = Boolean(settings?.enableDiscounts);
  const hasContactMethod = Boolean(String(customer?.email || "").trim() || String(customer?.phone || "").trim());
  const hasLoyaltyEnrollment = Boolean(customer?.loyaltyOptIn);
  const qualifiesForVip =
    summary.orderCount >= VIP_ORDER_THRESHOLD || summary.lifetimeSpend >= VIP_SPEND_THRESHOLD;

  if (customer?.isWalkIn) {
    return {
      loyaltyTier: "Walk-in",
      loyaltyStatus: "System profile",
      discountEligible: false,
      discountPercent: 0,
      discountReason: "Walk-in customers do not receive named loyalty discounts.",
    };
  }

  if (!hasLoyaltyEnrollment) {
    return {
      loyaltyTier: "Guest",
      loyaltyStatus: "Enrollment needed",
      discountEligible: false,
      discountPercent: 0,
      discountReason:
        "This customer needs to opt into the loyalty program before member pricing can activate.",
    };
  }

  if (qualifiesForVip) {
    return {
      loyaltyTier: "VIP",
      loyaltyStatus: "Priority account",
      discountEligible: discountsEnabled,
      discountPercent: discountsEnabled ? vipDiscountPct : 0,
      discountReason: discountsEnabled
        ? `${vipDiscountPct}% loyalty pricing is active for this VIP customer.`
        : "Discounts are currently disabled in settings.",
    };
  }

  if (hasContactMethod) {
    return {
      loyaltyTier: "Member",
      loyaltyStatus: "Registered profile",
      discountEligible: discountsEnabled,
      discountPercent: discountsEnabled ? defaultDiscountPct : 0,
      discountReason: discountsEnabled
        ? `${defaultDiscountPct}% loyalty pricing is available for named customer checkouts.`
        : "Discounts are currently disabled in settings.",
    };
  }

  return {
    loyaltyTier: "Member",
    loyaltyStatus: "Contact details needed",
    discountEligible: false,
    discountPercent: 0,
    discountReason: "Add a phone number or email to activate loyalty pricing for this enrolled customer.",
  };
}

function buildTopProducts(sales = []) {
  const totals = new Map();

  for (const sale of sales) {
    for (const item of Array.isArray(sale?.items) ? sale.items : []) {
      const key = String(item?.name || "").trim();
      if (!key) continue;

      const existing = totals.get(key) || {
        name: key,
        qty: 0,
        revenue: 0,
      };

      existing.qty += toFiniteNumber(item?.qty);
      existing.revenue += toFiniteNumber(item?.lineGrossTotal ?? item?.lineTotal ?? item?.lineSubtotal);
      totals.set(key, existing);
    }
  }

  return [...totals.values()]
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, 5)
    .map((item) => ({
      ...item,
      revenue: Number(item.revenue.toFixed(2)),
    }));
}

function buildMonthlySpend(sales = []) {
  const totals = new Map();

  for (const sale of sales) {
    const saleDate = normalizeTimestamp(sale?.date || sale?.createdAt);
    if (!saleDate) continue;

    const date = new Date(saleDate);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = date.toLocaleString("en-CA", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

    const existing = totals.get(key) || { key, label, revenue: 0, orders: 0 };
    existing.revenue += toFiniteNumber(sale?.total);
    existing.orders += 1;
    totals.set(key, existing);
  }

  return [...totals.values()]
    .sort((left, right) => String(left.key).localeCompare(String(right.key)))
    .slice(-6)
    .map((entry) => ({
      label: entry.label,
      revenue: Number(entry.revenue.toFixed(2)),
      orders: entry.orders,
    }));
}

function buildCustomerSummary(customer, customerSales = []) {
  const sortedSales = [...customerSales].sort((left, right) => {
    const leftTime = new Date(left?.date || left?.createdAt || 0).getTime();
    const rightTime = new Date(right?.date || right?.createdAt || 0).getTime();
    return rightTime - leftTime;
  });

  const orderCount = sortedSales.length;
  const lifetimeSpend = Number(
    sortedSales.reduce((sum, sale) => sum + toFiniteNumber(sale?.total), 0).toFixed(2)
  );
  const lifetimeTax = Number(
    sortedSales.reduce((sum, sale) => sum + toFiniteNumber(sale?.tax), 0).toFixed(2)
  );
  const totalUnits = sortedSales.reduce(
    (sum, sale) =>
      sum +
      (Array.isArray(sale?.items)
        ? sale.items.reduce((itemSum, item) => itemSum + toFiniteNumber(item?.qty), 0)
        : 0),
    0
  );
  const averageOrderValue = Number(
    (orderCount ? lifetimeSpend / orderCount : 0).toFixed(2)
  );
  const firstPurchaseAt = normalizeTimestamp(sortedSales[sortedSales.length - 1]?.date);
  const lastPurchaseAt = normalizeTimestamp(sortedSales[0]?.date);

  return {
    orderCount,
    lifetimeSpend,
    lifetimeTax,
    totalUnits,
    averageOrderValue,
    firstPurchaseAt,
    lastPurchaseAt,
    recentOrders: sortedSales.slice(0, 8).map((sale) => ({
      id: sale.id,
      date: sale.date,
      status: sale.status,
      total: toFiniteNumber(sale.total),
      paymentMethod: sale.paymentMethod,
      channel: sale.channel,
      itemCount: Array.isArray(sale?.items)
        ? sale.items.reduce((sum, item) => sum + toFiniteNumber(item?.qty), 0)
        : 0,
    })),
    topProducts: buildTopProducts(sortedSales),
    monthlySpend: buildMonthlySpend(sortedSales),
  };
}

function enrichCustomer(customer, { settings, sales }) {
  const customerSales = sales.filter((sale) => matchesCustomerSale(customer, sale));
  const summary = buildCustomerSummary(customer, customerSales);
  const loyalty = determineLoyaltyProfile(customer, settings, summary);
  const loyaltyCardNumber = customer?.loyaltyOptIn ? buildLoyaltyCardNumber(customer, settings) : "";
  const profileCompletenessPct = Math.round(
    ([
      Boolean(String(customer?.email || "").trim()),
      Boolean(String(customer?.phone || "").trim()),
      Boolean(String(customer?.notes || "").trim()),
      Boolean(customer?.loyaltyOptIn),
    ].filter(Boolean).length /
      4) *
      100
  );
  const status = determineCustomerStatus(summary.lastPurchaseAt);

  return {
    ...customer,
    customerNumber: buildCustomerNumber(customer),
    loyaltyNumber: loyaltyCardNumber || "Not issued",
    loyaltyCardNumber: loyaltyCardNumber || "",
    loyaltyTier: loyalty.loyaltyTier,
    loyaltyStatus: loyalty.loyaltyStatus,
    discountEligible: loyalty.discountEligible,
    discountPercent: loyalty.discountPercent,
    eligibleDiscountPct: loyalty.discountPercent,
    discountReason: loyalty.discountReason,
    loyaltyOptIn: Boolean(customer?.loyaltyOptIn),
    marketingOptIn: Boolean(customer?.marketingOptIn),
    preferredContactMethod: String(customer?.preferredContactMethod || "None").trim() || "None",
    loyaltyEnrolledAt: customer?.loyaltyEnrolledAt || null,
    loyaltyProgramStatus: customer?.loyaltyOptIn
      ? loyalty.discountEligible
        ? "Card active"
        : "Card issued"
      : "Not enrolled",
    customerStatus: status.label,
    customerStatusTone: status.tone,
    orderCount: summary.orderCount,
    lifetimeOrders: summary.orderCount,
    lifetimeSpend: summary.lifetimeSpend,
    lifetimeTax: summary.lifetimeTax,
    totalUnitsPurchased: summary.totalUnits,
    averageOrderValue: summary.averageOrderValue,
    firstPurchaseAt: summary.firstPurchaseAt,
    lastPurchaseAt: summary.lastPurchaseAt,
    profileCompletenessPct,
    contactCoverage: {
      hasEmail: Boolean(String(customer?.email || "").trim()),
      hasPhone: Boolean(String(customer?.phone || "").trim()),
      hasNotes: Boolean(String(customer?.notes || "").trim()),
    },
    nextBestCustomerAction: customer?.loyaltyOptIn
      ? loyalty.discountEligible
        ? "Use the loyalty card number or customer name in checkout to apply member pricing."
        : "Capture a phone number or email to unlock the discount tied to this loyalty card."
      : "Offer loyalty enrollment so future checkouts can track spend and unlock discounts.",
    recentOrders: summary.recentOrders,
    topProducts: summary.topProducts,
    monthlySpend: summary.monthlySpend,
  };
}

function matchesCustomerSearch(customer, search) {
  if (!search) return true;
  const haystack = [
    customer.name,
    customer.email,
    customer.phone,
    customer.notes,
    customer.customerNumber,
    customer.loyaltyCardNumber,
    customer.loyaltyTier,
    customer.loyaltyProgramStatus,
    customer.preferredContactMethod,
    customer.customerStatus,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(search.toLowerCase());
}

async function getCustomers(query = {}) {
  const filters = validateCustomerListQuery(query);
  const [customers, sales, settings] = await Promise.all([
    customerRepository.getCustomers(),
    salesRepository.getSales(),
    settingsRepository.getAppSettings(),
  ]);

  return customers
    .map((customer) => enrichCustomer(customer, { sales, settings }))
    .filter((customer) => matchesCustomerSearch(customer, filters.search));
}

async function resolveCustomerCheckoutProfile({ customerId = null, customerName = "" } = {}) {
  const normalizedName = String(customerName || "").trim();
  if (
    customerId === null &&
    (!normalizedName || normalizedName.toLowerCase() === "walk-in customer")
  ) {
    return null;
  }

  const [customers, sales, settings] = await Promise.all([
    customerRepository.getCustomers(),
    salesRepository.getSales(),
    settingsRepository.getAppSettings(),
  ]);

  const matchedCustomer =
    customers.find((customer) => Number(customer.id) === Number(customerId)) ||
    customers.find(
      (customer) =>
        String(customer?.name || "").trim().toLowerCase() === normalizedName.toLowerCase()
    ) ||
    null;

  if (!matchedCustomer) {
    return null;
  }

  return enrichCustomer(matchedCustomer, { sales, settings });
}

async function getCustomerById(id) {
  const [customer, sales, settings] = await Promise.all([
    customerRepository.getCustomerById(id),
    salesRepository.getSales(),
    settingsRepository.getAppSettings(),
  ]);

  if (!customer) {
    throw new AppError(404, "Customer not found.", {
      code: "CUSTOMER_NOT_FOUND",
    });
  }

  return enrichCustomer(customer, { sales, settings });
}

async function getCustomerEnrollmentPreview() {
  const [settings, nextCustomerId] = await Promise.all([
    settingsRepository.getAppSettings(),
    customerRepository.getNextCustomerId(),
  ]);

  const previewCustomer = {
    id: nextCustomerId,
    loyaltyOptIn: true,
  };

  return {
    nextCustomerId,
    customerNumber: buildCustomerNumber(previewCustomer),
    loyaltyNumber: buildLoyaltyCardNumber(previewCustomer, settings),
    loyaltyCardNumber: buildLoyaltyCardNumber(previewCustomer, settings),
    defaultDiscountPct: toFiniteNumber(settings?.defaultCustomerDiscountPct, 5),
    vipDiscountPct: toFiniteNumber(settings?.vipCustomerDiscountPct, 10),
    branchCode: String(settings?.branchCode || "AFR").trim() || "AFR",
  };
}

async function createCustomer(payload, actor) {
  const customer = validateCustomerPayload(payload);

  assertCondition(
    customer.name.toLowerCase() !== "walk-in customer",
    "Walk-in Customer is managed by the system and cannot be created manually."
  );
  assertCondition(
    !(await customerRepository.findCustomerByName(customer.name)),
    "A customer with this name already exists."
  );

  const createdCustomer = await customerRepository.createCustomer({
    ...customer,
    loyaltyEnrolledAt: customer.loyaltyOptIn ? new Date().toISOString() : null,
    isWalkIn: false,
  });

  await auditLogService.recordAuditEvent({
    actor,
    action: "customer.created",
    entityType: "customer",
    entityId: String(createdCustomer.id),
    details: {
      name: createdCustomer.name,
      email: createdCustomer.email,
      phone: createdCustomer.phone,
      loyaltyOptIn: createdCustomer.loyaltyOptIn,
    },
  });

  return getCustomerById(createdCustomer.id);
}

async function updateCustomer(id, payload, actor) {
  const existing = await getCustomerById(id);

  assertCondition(
    !existing.isWalkIn,
    "Walk-in Customer is managed by the system and cannot be edited manually.",
    409
  );

  const customer = validateCustomerPayload({
    ...existing,
    ...(payload || {}),
  });

  const wasEnrolled = Boolean(existing?.loyaltyOptIn);
  const nextEnrollmentTimestamp =
    customer.loyaltyOptIn && !wasEnrolled
      ? new Date().toISOString()
      : customer.loyaltyOptIn
        ? existing?.loyaltyEnrolledAt || new Date().toISOString()
        : null;

  assertCondition(
    !(await customerRepository.findCustomerByName(customer.name, existing.id)),
    "A customer with this name already exists."
  );

  const updatedCustomer = await customerRepository.updateCustomer(existing.id, {
    ...existing,
    ...customer,
    loyaltyEnrolledAt: nextEnrollmentTimestamp,
  });

  await auditLogService.recordAuditEvent({
    actor,
    action: "customer.updated",
    entityType: "customer",
    entityId: String(updatedCustomer.id),
    details: {
      previousName: existing.name,
      nextName: updatedCustomer.name,
      email: updatedCustomer.email,
      phone: updatedCustomer.phone,
      loyaltyOptIn: updatedCustomer.loyaltyOptIn,
    },
  });

  return getCustomerById(updatedCustomer.id);
}

async function deleteCustomer(id, actor) {
  const existing = await getCustomerById(id);

  assertCondition(
    !existing.isWalkIn,
    "Walk-in Customer is managed by the system and cannot be deleted.",
    409
  );

  try {
    const deletedCustomer = await customerRepository.deleteCustomer(existing.id);

    await auditLogService.recordAuditEvent({
      actor,
      action: "customer.deleted",
      entityType: "customer",
      entityId: String(deletedCustomer.id),
      details: {
        name: deletedCustomer.name,
      },
    });

    return deletedCustomer;
  } catch (error) {
    if (!/referenced by existing records|cannot be deleted/i.test(String(error?.message || ""))) {
      throw error;
    }

    throw new AppError(
      409,
      "This customer cannot be deleted because it is referenced by existing business records.",
      {
        code: "CUSTOMER_DELETE_CONFLICT",
      }
    );
  }
}

module.exports = {
  getCustomers,
  resolveCustomerCheckoutProfile,
  getCustomerById,
  getCustomerEnrollmentPreview,
  createCustomer,
  updateCustomer,
  deleteCustomer,
};
