const store = require("../data/storeRuntime");
const analyticsRepository = require("../data/repositories/analyticsRepository");

const RANGE_LIMITS = {
  daily: 14,
  weekly: 12,
  monthly: 12,
  yearly: 6,
};

const FORECAST_HORIZON = {
  daily: 7,
  weekly: 6,
  monthly: 4,
  yearly: 3,
};

const CATEGORY_COLORS = [
  "#1d4ed8",
  "#2563eb",
  "#3b82f6",
  "#60a5fa",
  "#93c5fd",
  "#0ea5e9",
  "#38bdf8",
  "#1e40af",
];

const PRODUCT_COLORS = [
  "#1d4ed8",
  "#2563eb",
  "#3b82f6",
  "#60a5fa",
  "#93c5fd",
  "#38bdf8",
  "#0ea5e9",
  "#1e40af",
];

const DAYPARTS = [
  { label: "Morning", startHour: 6, endHour: 11, fill: "#2563eb" },
  { label: "Midday", startHour: 11, endHour: 15, fill: "#3b82f6" },
  { label: "Afternoon", startHour: 15, endHour: 19, fill: "#60a5fa" },
  { label: "Evening", startHour: 19, endHour: 24, fill: "#1d4ed8" },
  { label: "Late Night", startHour: 0, endHour: 6, fill: "#93c5fd" },
];

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function addMonths(date, amount) {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + amount, 1);
  return copy;
}

function addYears(date, amount) {
  const copy = new Date(date);
  copy.setFullYear(copy.getFullYear() + amount, 0, 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function startOfWeek(date) {
  const copy = startOfDay(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function startOfMonth(date) {
  const copy = new Date(date);
  copy.setDate(1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function startOfYear(date) {
  const copy = new Date(date);
  copy.setMonth(0, 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addRangeStep(date, range, amount = 1) {
  switch (range) {
    case "daily":
      return addDays(date, amount);
    case "weekly":
      return addDays(date, amount * 7);
    case "yearly":
      return addYears(date, amount);
    case "monthly":
    default:
      return addMonths(date, amount);
  }
}

function startOfRange(date, range) {
  switch (range) {
    case "daily":
      return startOfDay(date);
    case "weekly":
      return startOfWeek(date);
    case "yearly":
      return startOfYear(date);
    case "monthly":
    default:
      return startOfMonth(date);
  }
}

function getRangeLimit(range) {
  return RANGE_LIMITS[range] || RANGE_LIMITS.monthly;
}

function getForecastHorizon(range) {
  return FORECAST_HORIZON[range] || FORECAST_HORIZON.monthly;
}

function shortMonth(date) {
  return date.toLocaleString("en-US", { month: "short" });
}

function formatBucketLabel(date, range) {
  switch (range) {
    case "daily":
      return `${shortMonth(date)} ${date.getDate()}`;
    case "weekly":
      return `Week of ${shortMonth(date)} ${date.getDate()}`;
    case "yearly":
      return `${date.getFullYear()}`;
    case "monthly":
    default:
      return `${shortMonth(date)} ${date.getFullYear()}`;
  }
}

function getBucketMeta(date, range) {
  const start = startOfRange(date, range);
  const end = addRangeStep(start, range, 1);
  let key = "";

  switch (range) {
    case "daily":
      key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(
        start.getDate()
      ).padStart(2, "0")}`;
      break;
    case "weekly":
      key = start.toISOString();
      break;
    case "yearly":
      key = `${start.getFullYear()}`;
      break;
    case "monthly":
    default:
      key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
      break;
  }

  return {
    key,
    start,
    end,
    label: formatBucketLabel(start, range),
    sortValue: start.getTime(),
  };
}

function buildBucketSeries(range, referenceDate, count) {
  const lastStart = startOfRange(referenceDate, range);
  const series = [];

  for (let index = count - 1; index >= 0; index -= 1) {
    series.push(getBucketMeta(addRangeStep(lastStart, range, -index), range));
  }

  return series;
}

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "paid" || value === "completed") return "Paid";
  if (value === "pending") return "Pending";
  if (value === "declined" || value === "failed") return "Declined";
  if (value === "refunded" || value === "refund") return "Refunded";
  return "Pending";
}

function normalizeChannel(channel) {
  const value = String(channel || "").trim().toLowerCase();
  if (value.includes("online")) return "Online";
  if (value.includes("deliver")) return "Delivery";
  if (value.includes("pick")) return "Pickup";
  return "In-Store";
}

function normalizePaymentMethod(method) {
  const value = String(method || "").trim().toLowerCase();
  if (value.includes("cash")) return "Cash";
  if (value.includes("transfer") || value.includes("bank")) return "Transfer";
  if (value.includes("wallet")) return "Wallet";
  return "Card";
}

function isNamedCustomer(customerName) {
  const value = String(customerName || "").trim().toLowerCase();
  if (!value) return false;
  return !["walk-in", "walk-in customer", "walk in", "guest", "anonymous"].includes(value);
}

function normalizeCurrency(currency) {
  const code = String(currency || "CAD").trim().toUpperCase();
  return code === "USD" ? "CAD" : code || "CAD";
}

function formatMoney(value, currency = "CAD") {
  const code = normalizeCurrency(currency);
  const locale = code === "CAD" ? "en-CA" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function formatPercent(value, digits = 1) {
  return `${toNumber(value).toFixed(digits)}%`;
}

function getDaysBetween(laterDate, earlierDate) {
  const later = safeDate(laterDate);
  const earlier = safeDate(earlierDate);
  if (!later || !earlier) return null;
  const milliseconds = later.getTime() - earlier.getTime();
  return Math.max(0, Math.round(milliseconds / (1000 * 60 * 60 * 24)));
}

function getLatestObservedAt(values = []) {
  const dates = values.map(safeDate).filter(Boolean);
  if (!dates.length) return new Date();
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function getLowStockThreshold(settings) {
  return Math.max(1, toNumber(settings?.lowStockThreshold, 10));
}

function withColor(items, palette) {
  return items.map((item, index) => ({
    ...item,
    fill: palette[index % palette.length],
  }));
}

function normalizeSale(sale, productMap) {
  const date = safeDate(sale.date || sale.createdAt || sale.updatedAt) || new Date();
  const items = (Array.isArray(sale.items) ? sale.items : []).map((item) => {
    const product = productMap.get(Number(item.id)) || {};
    const qty = toNumber(item.qty);
    const price = toNumber(item.price);
    const unitCost = toNumber(item.unitCost);
    const lineTotal = qty * price;
    const lineCost = qty * unitCost;
    const costKnown = unitCost > 0;

    return {
      id: Number(item.id),
      name: String(item.name || product.name || "").trim(),
      sku: String(item.sku || product.sku || "").trim(),
      qty,
      price,
      unitCost,
      lineTotal,
      lineCost,
      costKnown,
      category: String(product.category || "General").trim() || "General",
      supplier: String(product.supplier || "General Supplier").trim() || "General Supplier",
    };
  });

  const subtotal = toNumber(sale.subtotal, items.reduce((sum, item) => sum + item.lineTotal, 0));
  const tax = toNumber(sale.tax);
  const total = toNumber(sale.total, subtotal + tax);

  return {
    id: String(sale.id || "").trim(),
    subtotal,
    tax,
    total,
    cashierUserId:
      sale.cashierUserId === null || sale.cashierUserId === undefined
        ? null
        : Number(sale.cashierUserId),
    cashier: String(sale.cashier || "Front Desk").trim() || "Front Desk",
    customerId:
      sale.customerId === null || sale.customerId === undefined ? null : Number(sale.customerId),
    customer: String(sale.customer || "Walk-in Customer").trim() || "Walk-in Customer",
    status: normalizeStatus(sale.status),
    channel: normalizeChannel(sale.channel),
    paymentMethod: normalizePaymentMethod(sale.paymentMethod),
    date: date.toISOString(),
    createdAt: String(sale.createdAt || date.toISOString()),
    updatedAt: String(sale.updatedAt || sale.createdAt || date.toISOString()),
    dateObj: date,
    items,
  };
}

function normalizePurchaseOrder(order) {
  const createdAt = safeDate(order.createdAt) || new Date();
  const updatedAt = safeDate(order.updatedAt || order.createdAt) || createdAt;
  return {
    ...order,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    createdAtObj: createdAt,
    updatedAtObj: updatedAt,
    expectedDateObj: safeDate(order.expectedDate),
    sentAtObj: safeDate(order.sentAt),
    receivedAtObj: safeDate(order.receivedAt),
  };
}

function normalizeMovement(movement) {
  const createdAt = safeDate(movement.createdAt) || new Date();
  return {
    ...movement,
    createdAt: createdAt.toISOString(),
    createdAtObj: createdAt,
  };
}

function normalizeCycleCount(count) {
  const createdAt = safeDate(count.createdAt) || new Date();
  const updatedAt = safeDate(count.updatedAt || count.createdAt) || createdAt;
  return {
    ...count,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    createdAtObj: createdAt,
    updatedAtObj: updatedAt,
  };
}

function sanitizeSale(sale) {
  return {
    id: sale.id,
    subtotal: sale.subtotal,
    tax: sale.tax,
    total: sale.total,
    cashierUserId: sale.cashierUserId,
    cashier: sale.cashier,
    customerId: sale.customerId,
    customer: sale.customer,
    status: sale.status,
    channel: sale.channel,
    paymentMethod: sale.paymentMethod,
    date: sale.date,
    createdAt: sale.createdAt,
    updatedAt: sale.updatedAt,
    items: sale.items.map((item) => ({
      id: item.id,
      name: item.name,
      sku: item.sku,
      qty: item.qty,
      price: item.price,
      unitCost: item.unitCost,
      lineTotal: item.lineTotal,
      lineCost: item.lineCost,
      costKnown: item.costKnown,
      category: item.category,
      supplier: item.supplier,
    })),
  };
}

function buildAnalyticsContext(snapshot = {}) {
  const settings = snapshot.settings || {};
  const products = Array.isArray(snapshot.products) ? snapshot.products : [];
  const productMap = new Map(products.map((product) => [Number(product.id), product]));
  const rawSales = Array.isArray(snapshot.sales) ? snapshot.sales : [];
  const sales = rawSales
    .map((sale) => normalizeSale(sale, productMap))
    .sort((left, right) => left.dateObj.getTime() - right.dateObj.getTime());
  const purchaseOrders = (Array.isArray(snapshot.purchaseOrders) ? snapshot.purchaseOrders : []).map(
    normalizePurchaseOrder
  );
  const inventoryMovements = (
    Array.isArray(snapshot.inventoryMovements) ? snapshot.inventoryMovements : []
  ).map(normalizeMovement);
  const users = Array.isArray(snapshot.users) ? snapshot.users : [];
  const customers = Array.isArray(snapshot.customers) ? snapshot.customers : [];
  const suppliers = Array.isArray(snapshot.suppliers) ? snapshot.suppliers : [];
  const cycleCounts = (Array.isArray(snapshot.cycleCounts) ? snapshot.cycleCounts : []).map(
    normalizeCycleCount
  );
  const latestObservedAt = getLatestObservedAt([
    ...sales.map((sale) => sale.date),
    ...purchaseOrders.map((order) => order.updatedAt || order.createdAt),
    ...inventoryMovements.map((movement) => movement.createdAt),
    ...cycleCounts.map((count) => count.updatedAt || count.createdAt),
    new Date().toISOString(),
  ]);

  return {
    settings,
    products,
    productMap,
    sales,
    purchaseOrders,
    inventoryMovements,
    users,
    customers,
    suppliers,
    cycleCounts,
    latestObservedAt,
    currency: normalizeCurrency(settings?.currency),
  };
}

function getAnalyticsContext() {
  return buildAnalyticsContext({
    settings: store.getAppSettings(),
    products: store.getProducts(),
    sales: store.getSales(),
    purchaseOrders: store.getAllPurchaseOrders(),
    inventoryMovements: store.getAllInventoryMovements(),
    users: store.getUsers(),
    customers: store.getCustomers(),
    suppliers: store.getSuppliers(),
    cycleCounts: store.getAllCycleCounts(),
  });
}

async function getAnalyticsContextAsync() {
  return buildAnalyticsContext(await analyticsRepository.getAnalyticsWorkspaceSnapshot());
}

function filterSalesByPeriod(sales, start, end) {
  return sales.filter((sale) => sale.dateObj >= start && sale.dateObj < end);
}

function getPeriodBounds(range, referenceDate) {
  const currentStart = startOfRange(referenceDate, range);
  const currentEnd = addRangeStep(currentStart, range, 1);
  const previousStart = addRangeStep(currentStart, range, -1);
  const previousEnd = currentStart;

  return {
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
    latestLabel: formatBucketLabel(currentStart, range),
    previousLabel: formatBucketLabel(previousStart, range),
  };
}

function getPaidSales(sales) {
  return sales.filter((sale) => sale.status === "Paid");
}

function getAllSaleItems(sales) {
  return sales.flatMap((sale) =>
    sale.items.map((item) => ({
      ...item,
      saleId: sale.id,
      saleDate: sale.date,
      saleDateObj: sale.dateObj,
      saleStatus: sale.status,
      cashier: sale.cashier,
      customer: sale.customer,
      channel: sale.channel,
      paymentMethod: sale.paymentMethod,
    }))
  );
}

function computeAverageInventoryValue(products, inventoryMovements, periodStart, periodEnd) {
  return products.reduce((sum, product) => {
    const productId = Number(product.id);
    const currentStock = toNumber(product.stock);
    const unitCost = toNumber(product.unitCost);

    if (unitCost <= 0) {
      return sum;
    }

    const deltaSinceStart = inventoryMovements
      .filter(
        (movement) => Number(movement.productId) === productId && movement.createdAtObj >= periodStart
      )
      .reduce((total, movement) => total + toNumber(movement.quantityDelta), 0);
    const deltaAfterEnd = inventoryMovements
      .filter(
        (movement) => Number(movement.productId) === productId && movement.createdAtObj >= periodEnd
      )
      .reduce((total, movement) => total + toNumber(movement.quantityDelta), 0);

    const openingStock = Math.max(0, currentStock - deltaSinceStart);
    const closingStock = Math.max(0, currentStock - deltaAfterEnd);
    return sum + ((openingStock + closingStock) / 2) * unitCost;
  }, 0);
}

function buildMetrics(sales, products, settings, inventoryMovements, periodStart = null, periodEnd = null) {
  const paidSales = getPaidSales(sales);
  const paidItems = getAllSaleItems(paidSales);
  const paidRevenue = paidSales.reduce((sum, sale) => sum + sale.total, 0);
  const trackedRevenue = sales.reduce((sum, sale) => sum + sale.total, 0);
  const pendingRevenue = sales
    .filter((sale) => sale.status === "Pending")
    .reduce((sum, sale) => sum + sale.total, 0);
  const declinedRevenue = sales
    .filter((sale) => sale.status === "Declined")
    .reduce((sum, sale) => sum + sale.total, 0);
  const refundedRevenue = sales
    .filter((sale) => sale.status === "Refunded")
    .reduce((sum, sale) => sum + sale.total, 0);
  const costOfGoodsSold = paidItems
    .filter((item) => item.costKnown)
    .reduce((sum, item) => sum + item.lineCost, 0);
  const costedRevenue = paidItems
    .filter((item) => item.costKnown)
    .reduce((sum, item) => sum + item.lineTotal, 0);
  const uncostedRevenue = Math.max(0, paidRevenue - costedRevenue);
  const profit = costedRevenue - costOfGoodsSold;
  const averageOrderValue = paidSales.length > 0 ? paidRevenue / paidSales.length : 0;
  const totalUnitsSold = paidItems.reduce((sum, item) => sum + item.qty, 0);
  const uniqueProductsSold = new Set(paidItems.map((item) => item.id)).size;
  const totalInventoryValue = products.reduce(
    (sum, product) => sum + toNumber(product.stock) * toNumber(product.unitCost),
    0
  );
  const inventoryRetailValue = products.reduce(
    (sum, product) => sum + toNumber(product.stock) * toNumber(product.price),
    0
  );
  const lowStockThreshold = getLowStockThreshold(settings);
  const lowStockCount = products.filter(
    (product) => toNumber(product.stock) > 0 && toNumber(product.stock) <= lowStockThreshold
  ).length;
  const outOfStockCount = products.filter((product) => toNumber(product.stock) <= 0).length;

  let averageInventoryValue = 0;
  let inventoryTurnover = 0;
  if (periodStart && periodEnd && inventoryMovements.length) {
    averageInventoryValue = computeAverageInventoryValue(
      products,
      inventoryMovements,
      periodStart,
      periodEnd
    );
    inventoryTurnover = averageInventoryValue > 0 ? costOfGoodsSold / averageInventoryValue : 0;
  }

  return {
    totalRevenue: round(paidRevenue),
    paidRevenue: round(paidRevenue),
    trackedRevenue: round(trackedRevenue),
    pendingRevenue: round(pendingRevenue),
    declinedRevenue: round(declinedRevenue),
    refundedRevenue: round(refundedRevenue),
    totalOrders: sales.length,
    paidOrders: paidSales.length,
    pendingOrders: sales.filter((sale) => sale.status === "Pending").length,
    declinedOrders: sales.filter((sale) => sale.status === "Declined").length,
    refundedOrders: sales.filter((sale) => sale.status === "Refunded").length,
    averageOrderValue: round(averageOrderValue),
    paidRate: sales.length > 0 ? round((paidSales.length / sales.length) * 100, 1) : 0,
    totalUnitsSold,
    uniqueProductsSold,
    costOfGoodsSold: round(costOfGoodsSold),
    costedRevenue: round(costedRevenue),
    uncostedRevenue: round(uncostedRevenue),
    profit: round(profit),
    grossMargin: paidRevenue > 0 ? round((profit / paidRevenue) * 100, 1) : 0,
    profitCoverageRate: paidRevenue > 0 ? round((costedRevenue / paidRevenue) * 100, 1) : 100,
    totalInventoryValue: round(totalInventoryValue),
    inventoryRetailValue: round(inventoryRetailValue),
    lowStockCount,
    outOfStockCount,
    lowStockThreshold,
    averageInventoryValue: round(averageInventoryValue),
    inventoryTurnover: round(inventoryTurnover, 2),
  };
}

function buildComparison(currentMetrics, previousMetrics, range, latestLabel, previousLabel, categoryBreakdown) {
  const revenueChange =
    previousMetrics.totalRevenue > 0
      ? ((currentMetrics.totalRevenue - previousMetrics.totalRevenue) / previousMetrics.totalRevenue) * 100
      : currentMetrics.totalRevenue > 0
        ? 100
        : 0;
  const atRiskCurrent = currentMetrics.pendingRevenue + currentMetrics.declinedRevenue;
  const atRiskPrevious = previousMetrics.pendingRevenue + previousMetrics.declinedRevenue;
  const atRiskChange =
    atRiskPrevious > 0 ? ((atRiskCurrent - atRiskPrevious) / atRiskPrevious) * 100 : atRiskCurrent > 0 ? 100 : 0;
  const topCategoryShare =
    currentMetrics.totalRevenue > 0
      ? ((toNumber(categoryBreakdown[0]?.value) || 0) / currentMetrics.totalRevenue) * 100
      : 0;

  return {
    label: range,
    latestLabel,
    previousLabel,
    revenueChange: round(revenueChange, 1),
    paidRateDelta: round(currentMetrics.paidRate - previousMetrics.paidRate, 1),
    atRiskChange: round(atRiskChange, 1),
    topCategoryShare: round(topCategoryShare, 1),
  };
}

function getOverviewMetrics(context = getAnalyticsContext()) {
  return buildMetrics(
    context.sales,
    context.products,
    context.settings,
    context.inventoryMovements,
    null,
    null
  );
}

function getNormalizedSales(context = getAnalyticsContext()) {
  return context.sales.map(sanitizeSale);
}

function getSalesTrend(range = "monthly", context = getAnalyticsContext()) {
  const buckets = buildBucketSeries(range, context.latestObservedAt, getRangeLimit(range));
  const trendMap = new Map(
    buckets.map((bucket) => [
      bucket.key,
      {
        label: bucket.label,
        sortValue: bucket.sortValue,
        revenue: 0,
        orders: 0,
        averageOrderValue: 0,
      },
    ])
  );

  getPaidSales(context.sales).forEach((sale) => {
    const bucket = getBucketMeta(sale.dateObj, range);
    const trend = trendMap.get(bucket.key);
    if (!trend) return;
    trend.revenue += sale.total;
    trend.orders += 1;
  });

  return buckets.map((bucket) => {
    const trend = trendMap.get(bucket.key);
    return {
      label: trend.label,
      revenue: round(trend.revenue),
      orders: trend.orders,
      averageOrderValue: trend.orders > 0 ? round(trend.revenue / trend.orders) : 0,
    };
  });
}

function getStatusTrend(range = "monthly", context = getAnalyticsContext()) {
  const buckets = buildBucketSeries(range, context.latestObservedAt, getRangeLimit(range));
  const trendMap = new Map(
    buckets.map((bucket) => [
      bucket.key,
      {
        label: bucket.label,
        sortValue: bucket.sortValue,
        paidRevenue: 0,
        pendingRevenue: 0,
        declinedRevenue: 0,
        refundedRevenue: 0,
        totalRevenue: 0,
        paidOrders: 0,
        pendingOrders: 0,
        declinedOrders: 0,
        refundedOrders: 0,
        totalOrders: 0,
        paidRate: 0,
      },
    ])
  );

  context.sales.forEach((sale) => {
    const bucket = getBucketMeta(sale.dateObj, range);
    const trend = trendMap.get(bucket.key);
    if (!trend) return;

    trend.totalOrders += 1;
    trend.totalRevenue += sale.total;

    if (sale.status === "Paid") {
      trend.paidOrders += 1;
      trend.paidRevenue += sale.total;
    } else if (sale.status === "Pending") {
      trend.pendingOrders += 1;
      trend.pendingRevenue += sale.total;
    } else if (sale.status === "Declined") {
      trend.declinedOrders += 1;
      trend.declinedRevenue += sale.total;
    } else if (sale.status === "Refunded") {
      trend.refundedOrders += 1;
      trend.refundedRevenue += sale.total;
    }
  });

  return buckets.map((bucket) => {
    const trend = trendMap.get(bucket.key);
    return {
      label: trend.label,
      paidRevenue: round(trend.paidRevenue),
      pendingRevenue: round(trend.pendingRevenue),
      declinedRevenue: round(trend.declinedRevenue),
      refundedRevenue: round(trend.refundedRevenue),
      totalRevenue: round(trend.totalRevenue),
      paidOrders: trend.paidOrders,
      pendingOrders: trend.pendingOrders,
      declinedOrders: trend.declinedOrders,
      refundedOrders: trend.refundedOrders,
      totalOrders: trend.totalOrders,
      paidRate: trend.totalOrders > 0 ? round((trend.paidOrders / trend.totalOrders) * 100, 1) : 0,
    };
  });
}

function getStatusBreakdown(context = getAnalyticsContext()) {
  const statusMap = {};

  context.sales.forEach((sale) => {
    if (!statusMap[sale.status]) {
      statusMap[sale.status] = {
        label: sale.status,
        value: 0,
        revenue: 0,
      };
    }

    statusMap[sale.status].value += 1;
    statusMap[sale.status].revenue += sale.total;
  });

  return Object.values(statusMap)
    .sort((left, right) => right.value - left.value || right.revenue - left.revenue)
    .map((entry) => ({
      label: entry.label,
      value: entry.value,
      revenue: round(entry.revenue),
    }));
}

function getRevenueByStatus(context = getAnalyticsContext()) {
  return getStatusBreakdown(context).map((entry) => ({
    label: entry.label,
    value: entry.revenue,
    orders: entry.value,
  }));
}

function groupBreakdown(entries, labelAccessor, valueAccessor, revenueAccessor) {
  const groups = {};

  entries.forEach((entry) => {
    const label = labelAccessor(entry);
    if (!groups[label]) {
      groups[label] = {
        label,
        value: 0,
        revenue: 0,
      };
    }

    groups[label].value += valueAccessor(entry);
    groups[label].revenue += revenueAccessor(entry);
  });

  const totalOrders = Object.values(groups).reduce((sum, entry) => sum + entry.value, 0);

  return Object.values(groups)
    .sort((left, right) => right.revenue - left.revenue || right.value - left.value)
    .map((entry) => ({
      label: entry.label,
      value: entry.value,
      revenue: round(entry.revenue),
      share: totalOrders > 0 ? round((entry.value / totalOrders) * 100, 1) : 0,
    }));
}

function getPaymentMethodBreakdown(context = getAnalyticsContext()) {
  return groupBreakdown(
    context.sales,
    (sale) => sale.paymentMethod,
    () => 1,
    (sale) => (sale.status === "Paid" ? sale.total : 0)
  );
}

function getChannelBreakdown(context = getAnalyticsContext()) {
  return groupBreakdown(
    context.sales,
    (sale) => sale.channel,
    () => 1,
    (sale) => (sale.status === "Paid" ? sale.total : 0)
  );
}

function getDaypartLabel(date) {
  const hour = date.getHours();
  return (
    DAYPARTS.find((part) => {
      if (part.startHour < part.endHour) {
        return hour >= part.startHour && hour < part.endHour;
      }
      return hour >= part.startHour || hour < part.endHour;
    }) || DAYPARTS[0]
  );
}

function getDaypartPerformance(context = getAnalyticsContext()) {
  const paidSales = getPaidSales(context.sales);
  const daypartMap = new Map(
    DAYPARTS.map((part) => [
      part.label,
      {
        label: part.label,
        revenue: 0,
        orders: 0,
        averageOrderValue: 0,
        fill: part.fill,
      },
    ])
  );

  paidSales.forEach((sale) => {
    const part = getDaypartLabel(sale.dateObj);
    const entry = daypartMap.get(part.label);
    entry.revenue += sale.total;
    entry.orders += 1;
  });

  return DAYPARTS.map((part) => {
    const entry = daypartMap.get(part.label);
    return {
      label: entry.label,
      revenue: round(entry.revenue),
      orders: entry.orders,
      averageOrderValue: entry.orders > 0 ? round(entry.revenue / entry.orders) : 0,
      fill: part.fill,
    };
  }).filter((entry) => entry.orders > 0);
}

function getTopCashiers(limit = 5, context = getAnalyticsContext()) {
  const cashierMap = {};
  const paidRevenue = getPaidSales(context.sales).reduce((sum, sale) => sum + sale.total, 0);

  context.sales.forEach((sale) => {
    const name = sale.cashier || "Front Desk";
    if (!cashierMap[name]) {
      cashierMap[name] = {
        cashier: name,
        orders: 0,
        paidOrders: 0,
        pendingOrders: 0,
        declinedOrders: 0,
        refundedOrders: 0,
        revenue: 0,
      };
    }

    const entry = cashierMap[name];
    entry.orders += 1;

    if (sale.status === "Paid") {
      entry.paidOrders += 1;
      entry.revenue += sale.total;
    } else if (sale.status === "Pending") {
      entry.pendingOrders += 1;
    } else if (sale.status === "Declined") {
      entry.declinedOrders += 1;
    } else if (sale.status === "Refunded") {
      entry.refundedOrders += 1;
    }
  });

  return Object.values(cashierMap)
    .sort((left, right) => right.revenue - left.revenue || right.orders - left.orders)
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      averageOrderValue: entry.paidOrders > 0 ? round(entry.revenue / entry.paidOrders) : 0,
      paidRate: entry.orders > 0 ? round((entry.paidOrders / entry.orders) * 100, 1) : 0,
      share: paidRevenue > 0 ? round((entry.revenue / paidRevenue) * 100, 1) : 0,
    }));
}

function getCategoryValueData(context = getAnalyticsContext()) {
  const categoryMap = {};

  context.products.forEach((product) => {
    const category = String(product.category || "General").trim() || "General";
    if (!categoryMap[category]) {
      categoryMap[category] = {
        name: category,
        value: 0,
        units: 0,
        skus: 0,
      };
    }

    categoryMap[category].value += toNumber(product.stock) * toNumber(product.unitCost);
    categoryMap[category].units += toNumber(product.stock);
    categoryMap[category].skus += 1;
  });

  return withColor(
    Object.values(categoryMap)
      .sort((left, right) => right.value - left.value)
      .map((entry) => ({
        name: entry.name,
        value: round(entry.value),
        units: entry.units,
        skus: entry.skus,
      })),
    CATEGORY_COLORS
  );
}

function buildCategoryBreakdownFromSales(range = "monthly", context = getAnalyticsContext()) {
  const { currentStart, currentEnd } = getPeriodBounds(range, context.latestObservedAt);
  const paidSales = getPaidSales(filterSalesByPeriod(context.sales, currentStart, currentEnd));
  const categoryMap = {};

  paidSales.forEach((sale) => {
    sale.items.forEach((item) => {
      const key = item.category || "General";
      if (!categoryMap[key]) {
        categoryMap[key] = {
          name: key,
          value: 0,
          units: 0,
          profit: 0,
        };
      }

      categoryMap[key].value += item.lineTotal;
      categoryMap[key].units += item.qty;
      if (item.costKnown) {
        categoryMap[key].profit += item.lineTotal - item.lineCost;
      }
    });
  });

  return withColor(
    Object.values(categoryMap)
      .sort((left, right) => right.value - left.value)
      .map((entry) => ({
        name: entry.name,
        value: round(entry.value),
        units: entry.units,
        profit: round(entry.profit),
      })),
    CATEGORY_COLORS
  );
}

function buildTopProducts(range = "monthly", context = getAnalyticsContext()) {
  const { currentStart, currentEnd } = getPeriodBounds(range, context.latestObservedAt);
  const paidSales = getPaidSales(filterSalesByPeriod(context.sales, currentStart, currentEnd));
  const productMap = {};

  paidSales.forEach((sale) => {
    sale.items.forEach((item) => {
      const key = Number(item.id);
      if (!productMap[key]) {
        productMap[key] = {
          id: key,
          name: item.name,
          category: item.category,
          value: 0,
          units: 0,
          profit: 0,
        };
      }

      productMap[key].value += item.lineTotal;
      productMap[key].units += item.qty;
      if (item.costKnown) {
        productMap[key].profit += item.lineTotal - item.lineCost;
      }
    });
  });

  return withColor(
    Object.values(productMap)
      .sort((left, right) => right.value - left.value || right.units - left.units)
      .slice(0, 10)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        category: entry.category,
        value: round(entry.value),
        units: entry.units,
        profit: round(entry.profit),
      })),
    PRODUCT_COLORS
  );
}

function getInventorySignals(context = getAnalyticsContext()) {
  const lowStockThreshold = getLowStockThreshold(context.settings);
  const lowStockProducts = context.products
    .filter(
      (product) => toNumber(product.stock) > 0 && toNumber(product.stock) <= lowStockThreshold
    )
    .sort((left, right) => toNumber(left.stock) - toNumber(right.stock))
    .map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      category: product.category,
      supplier: product.supplier,
      stock: toNumber(product.stock),
      price: toNumber(product.price),
      unitCost: toNumber(product.unitCost),
    }));
  const outOfStockProducts = context.products
    .filter((product) => toNumber(product.stock) <= 0)
    .map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      category: product.category,
      supplier: product.supplier,
      stock: toNumber(product.stock),
      price: toNumber(product.price),
      unitCost: toNumber(product.unitCost),
    }));

  return {
    lowStockThreshold,
    lowStockCount: lowStockProducts.length,
    outOfStockCount: outOfStockProducts.length,
    lowStockProducts,
    outOfStockProducts,
  };
}

function buildProductPerformance(context) {
  const paidSales = getPaidSales(context.sales);
  const latestObservedAt = context.latestObservedAt;
  const recentWindowStart = addDays(latestObservedAt, -30);
  const openPurchaseOrders = context.purchaseOrders.filter(
    (order) => !["Received", "Cancelled"].includes(String(order.status || "").trim())
  );
  const inboundByProduct = {};

  openPurchaseOrders.forEach((order) => {
    (Array.isArray(order.items) ? order.items : []).forEach((item) => {
      const openUnits = Math.max(0, toNumber(item.qtyOrdered) - toNumber(item.qtyReceived));
      if (openUnits <= 0) return;
      inboundByProduct[Number(item.productId)] = (inboundByProduct[Number(item.productId)] || 0) + openUnits;
    });
  });

  const productSalesMap = {};
  paidSales.forEach((sale) => {
    sale.items.forEach((item) => {
      const key = Number(item.id);
      if (!productSalesMap[key]) {
        productSalesMap[key] = {
          unitsSold: 0,
          revenue: 0,
          recentRevenue: 0,
          cogs: 0,
          costedRevenue: 0,
          lastSoldAt: null,
          recentUnitsSold: 0,
        };
      }

      const entry = productSalesMap[key];
      entry.unitsSold += item.qty;
      entry.revenue += item.lineTotal;
      if (item.costKnown) {
        entry.cogs += item.lineCost;
        entry.costedRevenue += item.lineTotal;
      }

      if (!entry.lastSoldAt || sale.dateObj > entry.lastSoldAt) {
        entry.lastSoldAt = sale.dateObj;
      }

      if (sale.dateObj >= recentWindowStart) {
        entry.recentRevenue += item.lineTotal;
        entry.recentUnitsSold += item.qty;
      }
    });
  });

  return context.products.map((product) => {
    const activity = productSalesMap[Number(product.id)] || {
      unitsSold: 0,
      revenue: 0,
      recentRevenue: 0,
      cogs: 0,
      costedRevenue: 0,
      lastSoldAt: null,
      recentUnitsSold: 0,
    };
    const stock = toNumber(product.stock);
    const avgDailyUnitsSold = activity.recentUnitsSold > 0 ? activity.recentUnitsSold / 30 : 0;
    const estimatedDaysCover = avgDailyUnitsSold > 0 ? stock / avgDailyUnitsSold : null;
    const lastSoldAt = activity.lastSoldAt ? activity.lastSoldAt.toISOString() : null;
    const daysSinceLastSale = activity.lastSoldAt ? getDaysBetween(latestObservedAt, activity.lastSoldAt) : null;
    const stockValue = stock * toNumber(product.unitCost);
    const profit = activity.costedRevenue - activity.cogs;
    const inboundUnits = toNumber(inboundByProduct[Number(product.id)]);
    const lowStockThreshold = getLowStockThreshold(context.settings);

    let status = "Healthy";
    let urgencyScore = 0;
    if (stock <= 0) {
      status = inboundUnits > 0 ? "Awaiting Receipt" : "Out of Stock";
      urgencyScore = inboundUnits > 0 ? 82 : 100;
    } else if (stock <= lowStockThreshold) {
      status = inboundUnits > 0 ? "Covered Reorder" : "Reorder Soon";
      urgencyScore = inboundUnits > 0 ? 68 : 88;
    } else if (estimatedDaysCover !== null && estimatedDaysCover <= 14) {
      status = inboundUnits > 0 ? "Covered Reorder" : "Watch";
      urgencyScore = inboundUnits > 0 ? 54 : 70;
    } else if (daysSinceLastSale !== null && daysSinceLastSale >= 45 && stockValue > 0) {
      status = "Dormant";
      urgencyScore = 46;
    }

    if (estimatedDaysCover !== null) {
      if (estimatedDaysCover <= 3) urgencyScore += 16;
      else if (estimatedDaysCover <= 7) urgencyScore += 10;
      else if (estimatedDaysCover <= 14) urgencyScore += 6;
    }

    if (activity.revenue > 0) {
      urgencyScore += clamp(activity.recentRevenue / 250, 0, 12);
    }

    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      category: product.category,
      supplier: product.supplier,
      stock,
      price: toNumber(product.price),
      unitCost: toNumber(product.unitCost),
      stockValue: round(stockValue),
      unitsSold: activity.unitsSold,
      revenue: round(activity.revenue),
      recentRevenue: round(activity.recentRevenue),
      cogs: round(activity.cogs),
      profit: round(profit),
      costCoverageRate:
        activity.revenue > 0 ? round((activity.costedRevenue / activity.revenue) * 100, 1) : 100,
      lastSoldAt,
      daysSinceLastSale,
      avgDailyUnitsSold: round(avgDailyUnitsSold, 2),
      estimatedDaysCover: estimatedDaysCover === null ? null : round(estimatedDaysCover, 1),
      inboundUnits,
      urgencyScore: round(urgencyScore, 1),
      status,
    };
  });
}

function getInventoryIntelligence(context = getAnalyticsContext()) {
  const performance = buildProductPerformance(context);
  const reorderNow = performance
    .filter(
      (product) =>
        ["Out of Stock", "Awaiting Receipt", "Reorder Soon", "Covered Reorder", "Watch"].includes(
          product.status
        ) && (product.stock <= getLowStockThreshold(context.settings) || product.estimatedDaysCover <= 14)
    )
    .sort((left, right) => right.urgencyScore - left.urgencyScore || left.stock - right.stock);
  const dormantStock = performance
    .filter((product) => product.status === "Dormant")
    .sort((left, right) => right.stockValue - left.stockValue)
    .slice(0, 8);

  const supplierMap = {};
  performance.forEach((product) => {
    const supplier = product.supplier || "General Supplier";
    if (!supplierMap[supplier]) {
      supplierMap[supplier] = {
        supplier,
        lowStockLines: 0,
        exposedSkuCount: 0,
        openUnits: 0,
        exposedRevenue: 0,
        topExposure: null,
      };
    }

    const entry = supplierMap[supplier];
    if (product.stock <= getLowStockThreshold(context.settings)) {
      entry.lowStockLines += 1;
      entry.exposedSkuCount += 1;
      entry.exposedRevenue += product.recentRevenue || product.revenue;
      entry.openUnits += product.inboundUnits;

      if (!entry.topExposure || product.urgencyScore > entry.topExposure.urgencyScore) {
        entry.topExposure = {
          name: product.name,
          stock: product.stock,
          urgencyScore: product.urgencyScore,
          estimatedDaysCover: product.estimatedDaysCover,
        };
      }
    }
  });

  const supplierWatch = Object.values(supplierMap)
    .filter((supplier) => supplier.lowStockLines > 0)
    .sort((left, right) => right.exposedRevenue - left.exposedRevenue || right.lowStockLines - left.lowStockLines)
    .slice(0, 6)
    .map((entry) => ({
      supplier: entry.supplier,
      lowStockLines: entry.lowStockLines,
      exposedSkuCount: entry.exposedSkuCount,
      openUnits: entry.openUnits,
      exposedRevenue: round(entry.exposedRevenue),
      topExposure: entry.topExposure,
      tone: entry.lowStockLines >= 2 && entry.openUnits === 0 ? "danger" : "warning",
    }));

  const categoryPressureMap = {};
  reorderNow.forEach((product) => {
    const category = product.category || "General";
    if (!categoryPressureMap[category]) {
      categoryPressureMap[category] = {
        category,
        products: 0,
        stockValue: 0,
        revenue: 0,
      };
    }

    categoryPressureMap[category].products += 1;
    categoryPressureMap[category].stockValue += product.stockValue;
    categoryPressureMap[category].revenue += product.recentRevenue || product.revenue;
  });

  const categoryPressure = Object.values(categoryPressureMap)
    .sort((left, right) => right.revenue - left.revenue || right.products - left.products)
    .map((entry) => ({
      category: entry.category,
      products: entry.products,
      stockValue: round(entry.stockValue),
      revenue: round(entry.revenue),
    }));

  const totalStockValue = context.products.reduce(
    (sum, product) => sum + toNumber(product.stock) * toNumber(product.unitCost),
    0
  );
  const dormantStockValue = dormantStock.reduce((sum, product) => sum + product.stockValue, 0);

  return {
    summary: {
      reorderNowCount: reorderNow.length,
      dormantStockCount: dormantStock.length,
      dormantStockValue: round(dormantStockValue),
      supplierWatchCount: supplierWatch.length,
      categoryPressureCount: categoryPressure.length,
      exposedStockValue: round(reorderNow.reduce((sum, product) => sum + product.stockValue, 0)),
      exposedRevenue: round(reorderNow.reduce((sum, product) => sum + (product.recentRevenue || product.revenue), 0)),
      stockValueCoverage:
        totalStockValue > 0 ? round((dormantStockValue / totalStockValue) * 100, 1) : 0,
    },
    reorderNow,
    dormantStock,
    supplierWatch,
    categoryPressure,
  };
}

function buildProjectionSeries(trend, range) {
  const horizon = getForecastHorizon(range);
  if (!trend.length) return [];

  const recent = trend.slice(-Math.min(4, trend.length));
  const latest = recent[recent.length - 1];
  const averageRevenue = recent.reduce((sum, entry) => sum + toNumber(entry.revenue), 0) / recent.length;
  const averageOrders = recent.reduce((sum, entry) => sum + toNumber(entry.orders), 0) / recent.length;
  let revenueDelta = 0;
  let orderDelta = 0;

  if (recent.length > 1) {
    const revenueDeltas = [];
    const orderDeltas = [];
    for (let index = 1; index < recent.length; index += 1) {
      revenueDeltas.push(toNumber(recent[index].revenue) - toNumber(recent[index - 1].revenue));
      orderDeltas.push(toNumber(recent[index].orders) - toNumber(recent[index - 1].orders));
    }
    revenueDelta = revenueDeltas.reduce((sum, value) => sum + value, 0) / revenueDeltas.length;
    orderDelta = orderDeltas.reduce((sum, value) => sum + value, 0) / orderDeltas.length;
  }

  const lastStart = safeDate(recent[recent.length - 1].bucketStart) || startOfRange(new Date(), range);

  return Array.from({ length: horizon }, (_, index) => {
    const step = index + 1;
    const bucket = getBucketMeta(addRangeStep(lastStart, range, step), range);
    const revenueFromTrend = toNumber(latest.revenue) + revenueDelta * step;
    const revenueFromAverage = averageRevenue + revenueDelta * Math.max(step - 1, 0) * 0.6;
    const projectedRevenue = Math.max(0, revenueFromTrend * 0.65 + revenueFromAverage * 0.35);
    const projectedOrders = Math.max(
      0,
      Math.round(toNumber(latest.orders) + orderDelta * step * 0.6 + averageOrders * 0.1)
    );

    return {
      label: bucket.label,
      revenue: round(projectedRevenue),
      orders: projectedOrders,
      averageOrderValue: projectedOrders > 0 ? round(projectedRevenue / projectedOrders) : 0,
      basis: `Trailing ${recent.length} ${range} points`,
    };
  });
}

function buildForecast(range = "monthly", context = getAnalyticsContext()) {
  const baseTrend = getSalesTrend(range, context).map((item, index, collection) => {
    const bucketDate = addRangeStep(startOfRange(context.latestObservedAt, range), range, index - collection.length + 1);
    return {
      ...item,
      bucketStart: bucketDate.toISOString(),
    };
  });
  return buildProjectionSeries(baseTrend, range);
}

function generateInsights(report, inventoryIntel, customerIntel) {
  const insights = [];
  const topCategory = report.categoryBreakdown[0] || null;
  const topProduct = report.topProducts[0] || null;
  const topWindow = [...report.daypartPerformance].sort((left, right) => right.revenue - left.revenue)[0] || null;
  const atRiskRevenue = toNumber(report.summary.pendingRevenue) + toNumber(report.summary.declinedRevenue);

  if (report.summary.profitCoverageRate < 95) {
    insights.push({
      title: "Cost coverage is incomplete",
      message: `${formatMoney(report.summary.uncostedRevenue, report.currency)} of paid revenue still has no recorded unit cost, so profit is only grounded on ${formatPercent(report.summary.profitCoverageRate)} of revenue.`,
      type: "warning",
    });
  }

  if (atRiskRevenue > 0) {
    insights.push({
      title: "Cash is leaking outside paid capture",
      message: `${formatMoney(atRiskRevenue, report.currency)} is sitting in pending or declined orders for the current comparison window.`,
      type: atRiskRevenue >= report.summary.totalRevenue * 0.2 ? "negative" : "warning",
    });
  }

  if (topCategory && report.summary.totalRevenue > 0) {
    const share = (topCategory.value / report.summary.totalRevenue) * 100;
    insights.push({
      title: "Demand concentration is visible",
      message: `${topCategory.name} is carrying ${formatPercent(share)} of recognized revenue in this period.`,
      type: share >= 45 ? "warning" : "positive",
    });
  }

  if (topProduct) {
    insights.push({
      title: "One product is clearly leading",
      message: `${topProduct.name} generated ${formatMoney(topProduct.value, report.currency)} and is the first SKU to protect from stock breaks.`,
      type: "positive",
    });
  }

  if (inventoryIntel.reorderNow.length > 0) {
    const leadRisk = inventoryIntel.reorderNow[0];
    insights.push({
      title: "Inventory exposure is immediate",
      message: `${leadRisk.name} is the lead runout risk with ${leadRisk.stock} units and ${
        leadRisk.estimatedDaysCover === null
          ? "no measurable days-cover yet"
          : `${leadRisk.estimatedDaysCover} days of cover`
      }.`,
      type: leadRisk.stock <= 0 ? "negative" : "warning",
    });
  }

  if ((customerIntel?.summary?.repeatRevenue || 0) > 0) {
    insights.push({
      title: "Repeat demand is now measurable",
      message: `${formatMoney(customerIntel.summary.repeatRevenue, report.currency)} is already coming from returning customers, which makes future demand more defensible.`,
      type: "positive",
    });
  }

  if (topWindow) {
    insights.push({
      title: "A real trading window is emerging",
      message: `${topWindow.label} is the strongest revenue window at ${formatMoney(topWindow.revenue, report.currency)} across ${topWindow.orders} paid orders.`,
      type: "positive",
    });
  }

  return insights.slice(0, 6);
}

function buildExecutiveSummary(report, inventoryIntel) {
  const { summary, comparisons } = report;
  const atRiskRevenue = toNumber(summary.pendingRevenue) + toNumber(summary.declinedRevenue);
  const leadRisk = inventoryIntel.reorderNow[0] || null;
  let statusTone = "success";
  let headline = "Revenue quality is stable and readable.";
  let summaryText = `${formatMoney(summary.totalRevenue, report.currency)} was recognized in ${comparisons.latestLabel}, with ${summary.paidOrders} paid orders and ${formatMoney(summary.profit, report.currency)} of cost-backed gross profit.`;
  let whyItMatters =
    "This reporting layer is now grounded in what the database can actually prove: paid revenue, real sale lines, and recorded inventory cost.";
  let nextMove = "Protect the strongest category, keep cash leakage low, and keep unit-cost capture complete.";

  if (summary.profitCoverageRate < 95) {
    statusTone = "warning";
    headline = "Revenue is real, but profit coverage is still incomplete.";
    summaryText = `${formatMoney(summary.uncostedRevenue, report.currency)} of paid revenue is missing recorded unit cost, so reported profit is partial rather than full-business margin.`;
    whyItMatters =
      "Incomplete cost capture hides true margin quality and makes product, category, and supplier decisions less reliable.";
    nextMove = "Backfill supplier cost on the uncosted SKUs and keep receiving flows writing unit cost on every inbound line.";
  } else if (atRiskRevenue > summary.totalRevenue * 0.2 && atRiskRevenue > 0) {
    statusTone = "warning";
    headline = "Cash capture is softer than demand.";
    summaryText = `${formatMoney(atRiskRevenue, report.currency)} is still outside paid capture in the current comparison window, which is weakening the usable revenue picture.`;
    whyItMatters =
      "Demand only helps the business if it converts into paid orders that can fund inventory and operating decisions.";
    nextMove = "Work the pending and declined queue first, then tighten the highest-friction checkout path.";
  } else if (leadRisk && leadRisk.stock <= 0) {
    statusTone = "danger";
    headline = "Inventory risk is already touching live demand.";
    summaryText = `${leadRisk.name} is already out of stock while it is still contributing to recent revenue, so the next revenue step is exposed.`;
    whyItMatters =
      "When a lead item breaks stock, the business loses conversion, basket size, and repeat confidence in one move.";
    nextMove = `Restore cover on ${leadRisk.name} immediately and verify inbound timing with ${leadRisk.supplier}.`;
  }

  return {
    statusTone,
    headline,
    summary: summaryText,
    whyItMatters,
    nextMove,
    actions: [
      {
        label: "Review revenue runway",
        note: "Open the live revenue and profit path against the next projected period.",
        focus: "reports-runway",
      },
      {
        label: "Inspect category concentration",
        note: "See which category is carrying revenue and whether the mix is getting narrow.",
        focus: "reports-category-concentration",
      },
      {
        label: "Protect exposed products",
        note: "Open the product ladder and pair it with the current stock-risk queue.",
        focus: "reports-product-dependence",
      },
    ],
  };
}

function buildWhatChanged(report) {
  const atRiskRevenue = toNumber(report.summary.pendingRevenue) + toNumber(report.summary.declinedRevenue);
  return [
    {
      label: "Recognized Revenue",
      value: `${report.comparisons.revenueChange >= 0 ? "+" : ""}${report.comparisons.revenueChange.toFixed(1)}%`,
      note: `Now ${formatMoney(report.summary.totalRevenue, report.currency)} in ${report.comparisons.latestLabel}.`,
      tone:
        report.comparisons.revenueChange < 0 ? "warning" : report.comparisons.revenueChange > 4 ? "success" : "neutral",
      focus: "reports-runway",
    },
    {
      label: "Paid Conversion",
      value: `${report.comparisons.paidRateDelta >= 0 ? "+" : ""}${report.comparisons.paidRateDelta.toFixed(1)} pts`,
      note: `${formatPercent(report.summary.paidRate)} paid rate across ${report.summary.totalOrders} tracked orders.`,
      tone: report.comparisons.paidRateDelta < 0 ? "warning" : "success",
      focus: "reports-runway",
    },
    {
      label: "Cash At Risk",
      value: formatMoney(atRiskRevenue, report.currency),
      note: `${report.summary.pendingOrders + report.summary.declinedOrders} orders are still outside paid capture.`,
      tone: atRiskRevenue > 0 ? "warning" : "success",
      focus: "reports-runway",
    },
    {
      label: "Profit Coverage",
      value: formatPercent(report.summary.profitCoverageRate),
      note: `${formatMoney(report.summary.uncostedRevenue, report.currency)} of paid revenue still lacks stored unit cost.`,
      tone: report.summary.profitCoverageRate < 95 ? "warning" : "success",
      focus: "reports-product-dependence",
    },
  ];
}

function buildActionSignals(report, inventoryIntel) {
  const leadRisk = inventoryIntel.reorderNow[0] || null;
  const topCategory = report.categoryBreakdown[0] || null;
  return [
    {
      title: "Gross Profit",
      value: formatMoney(report.summary.profit, report.currency),
      message:
        report.summary.profitCoverageRate < 95
          ? "This profit is only partial because unit cost is still missing on part of paid revenue."
          : "Profit is grounded in recorded sale-line unit cost, not a modeled margin assumption.",
      tone: report.summary.profitCoverageRate < 95 ? "warning" : "success",
      focus: "reports-runway",
    },
    {
      title: "Inventory Turnover",
      value: report.summary.inventoryTurnover > 0 ? `${report.summary.inventoryTurnover.toFixed(2)}x` : "Not enough history",
      message:
        report.summary.averageInventoryValue > 0
          ? `Based on recorded cost of goods sold over an average inventory value of ${formatMoney(
              report.summary.averageInventoryValue,
              report.currency
            )}.`
          : "Average inventory value cannot be measured cleanly for this period yet.",
      tone: report.summary.inventoryTurnover > 0 ? "success" : "neutral",
      focus: "reports-runway",
    },
    {
      title: "Lead Category",
      value: topCategory?.name || "No leader yet",
      message: topCategory
        ? `${formatMoney(topCategory.value, report.currency)} is concentrated in the leading category for this period.`
        : "Category leadership appears once more paid sales accumulate.",
      tone: topCategory ? "success" : "neutral",
      focus: "reports-category-concentration",
    },
    {
      title: "Runout Queue",
      value: `${inventoryIntel.reorderNow.length}`,
      message: leadRisk
        ? `${leadRisk.name} is the next stock break to defend.`
        : "No immediate stock break is visible in the current product picture.",
      tone: leadRisk ? (leadRisk.stock <= 0 ? "danger" : "warning") : "success",
      focus: "reports-product-dependence",
    },
  ];
}

function getReportsDataset(range = "monthly", context = getAnalyticsContext()) {
  const bounds = getPeriodBounds(range, context.latestObservedAt);
  const currentSales = filterSalesByPeriod(context.sales, bounds.currentStart, bounds.currentEnd);
  const previousSales = filterSalesByPeriod(context.sales, bounds.previousStart, bounds.previousEnd);
  const summary = buildMetrics(
    currentSales,
    context.products,
    context.settings,
    context.inventoryMovements,
    bounds.currentStart,
    bounds.currentEnd
  );
  const previousSummary = buildMetrics(
    previousSales,
    context.products,
    context.settings,
    context.inventoryMovements,
    bounds.previousStart,
    bounds.previousEnd
  );
  const trend = getSalesTrend(range, context);
  const statusTrend = getStatusTrend(range, context);
  const daypartPerformance = getDaypartPerformance({
    ...context,
    sales: currentSales,
  });
  const categoryBreakdown = buildCategoryBreakdownFromSales(range, context);
  const topProducts = buildTopProducts(range, context);
  const comparisons = buildComparison(
    summary,
    previousSummary,
    range,
    bounds.latestLabel,
    bounds.previousLabel,
    categoryBreakdown
  );
  const forecast = buildForecast(range, context);
  const inventoryIntel = getInventoryIntelligence(context);
  const customers = getCustomersDataset(range, context);
  const report = {
    range,
    currency: context.currency,
    generatedAt:
      context.latestObservedAt instanceof Date
        ? context.latestObservedAt.toISOString()
        : new Date().toISOString(),
    summary,
    trend,
    forecast,
    statusTrend,
    daypartPerformance,
    categoryBreakdown,
    topProducts,
    comparisons,
  };
  const executiveSummary = buildExecutiveSummary(report, inventoryIntel);
  const whatChanged = buildWhatChanged(report);
  const actionSignals = buildActionSignals(report, inventoryIntel);
  const insights = generateInsights(report, inventoryIntel, customers);

  return {
    ...report,
    executiveSummary,
    whatChanged,
    actionSignals,
    insights,
  };
}

function buildCustomerTrend(range, sales, referenceDate) {
  const buckets = buildBucketSeries(range, referenceDate, getRangeLimit(range));
  const trendMap = new Map(
    buckets.map((bucket) => [
      bucket.key,
      {
        label: bucket.label,
        namedRevenue: 0,
        walkInRevenue: 0,
        repeatRevenue: 0,
        uniqueCustomers: new Set(),
        repeatCustomers: new Set(),
      },
    ])
  );

  const customerOrderCounts = {};
  getPaidSales(sales).forEach((sale) => {
    if (isNamedCustomer(sale.customer)) {
      customerOrderCounts[sale.customer] = (customerOrderCounts[sale.customer] || 0) + 1;
    }
  });

  getPaidSales(sales).forEach((sale) => {
    const bucket = getBucketMeta(sale.dateObj, range);
    const trend = trendMap.get(bucket.key);
    if (!trend) return;

    if (isNamedCustomer(sale.customer)) {
      trend.namedRevenue += sale.total;
      trend.uniqueCustomers.add(sale.customer);
      if (toNumber(customerOrderCounts[sale.customer]) >= 2) {
        trend.repeatRevenue += sale.total;
        trend.repeatCustomers.add(sale.customer);
      }
    } else {
      trend.walkInRevenue += sale.total;
    }
  });

  return buckets.map((bucket) => {
    const trend = trendMap.get(bucket.key);
    return {
      label: trend.label,
      namedRevenue: round(trend.namedRevenue),
      walkInRevenue: round(trend.walkInRevenue),
      repeatRevenue: round(trend.repeatRevenue),
      uniqueCustomers: trend.uniqueCustomers.size,
      repeatCustomers: trend.repeatCustomers.size,
    };
  });
}

function buildCustomerExecutive(summary, topCustomer, topCustomerShare, repeatCustomers, currency = "CAD") {
  if (!summary.totalCustomers) {
    return {
      statusTone: "warning",
      headline: "Named demand is still too thin to guide customer strategy.",
      summary: "The database can separate walk-in and known customers, but repeat behavior is still too light to defend.",
      whyItMatters:
        "Without enough named customer history, the business cannot see who is worth protecting or who is starting to cool.",
      nextMove: "Capture more named customers at checkout and keep identity fields consistent.",
    };
  }

  if (summary.walkInRevenueShare >= 70) {
    return {
      statusTone: "warning",
      headline: "Customer demand is still too anonymous.",
      summary: `${formatPercent(summary.walkInRevenueShare)} of paid revenue is still coming from walk-in demand, so repeat behavior is only partly visible.`,
      whyItMatters:
        "Anonymous demand is harder to protect, recover, and grow because the owner cannot see who is actually returning.",
      nextMove: "Capture more named customers on the next wave of paid orders and protect the best known account first.",
    };
  }

  if (summary.repeatCustomerRate >= 30 && topCustomer) {
    return {
      statusTone: "success",
      headline: "Repeat customer signal is becoming usable.",
      summary: `${repeatCustomers.length} customers are already repeating and ${topCustomer.customer} is leading named demand with ${formatPercent(topCustomerShare)} of known revenue.`,
      whyItMatters:
        "Repeat demand gives the business a real base to protect instead of relying only on one-time traffic.",
      nextMove: `Protect ${topCustomer.customer}, then work the accounts most likely to become repeat customers next.`,
    };
  }

  return {
    statusTone: "success",
    headline: "Named customer quality is improving.",
    summary: `${summary.totalCustomers} named customers are visible and ${formatMoney(summary.namedRevenue, currency)} of paid revenue is already tied to known demand.`,
    whyItMatters:
      "Once revenue is connected to people instead of anonymous traffic, retention and promotion decisions become more defensible.",
    nextMove: "Turn new named accounts into a second purchase before they cool.",
  };
}

function getCustomersDataset(range = "monthly", context = getAnalyticsContext()) {
  const paidSales = getPaidSales(context.sales);
  const latestObservedAt = context.latestObservedAt;
  const customerMap = {};
  let paidRevenue = 0;
  let walkInRevenue = 0;

  paidSales.forEach((sale) => {
    paidRevenue += sale.total;
    if (!isNamedCustomer(sale.customer)) {
      walkInRevenue += sale.total;
      return;
    }

    if (!customerMap[sale.customer]) {
      const masterCustomer =
        context.customers.find((customer) => String(customer.name).trim() === String(sale.customer).trim()) || null;
      customerMap[sale.customer] = {
        customer: sale.customer,
        customerId: masterCustomer?.id || sale.customerId || null,
        email: masterCustomer?.email || "",
        phone: masterCustomer?.phone || "",
        notes: masterCustomer?.notes || "",
        orders: 0,
        paidOrders: 0,
        revenue: 0,
        paidRevenue: 0,
        atRiskRevenue: 0,
        firstSeen: sale.dateObj,
        lastSeen: sale.dateObj,
        categories: {},
        channels: {},
        paymentMethods: {},
      };
    }

    const customer = customerMap[sale.customer];
    customer.orders += 1;
    customer.paidOrders += 1;
    customer.revenue += sale.total;
    customer.paidRevenue += sale.total;

    if (sale.dateObj < customer.firstSeen) customer.firstSeen = sale.dateObj;
    if (sale.dateObj > customer.lastSeen) customer.lastSeen = sale.dateObj;

    customer.channels[sale.channel] = (customer.channels[sale.channel] || 0) + sale.total;
    customer.paymentMethods[sale.paymentMethod] =
      (customer.paymentMethods[sale.paymentMethod] || 0) + 1;

    sale.items.forEach((item) => {
      customer.categories[item.category] =
        (customer.categories[item.category] || 0) + item.lineTotal;
    });
  });

  let customers = Object.values(customerMap)
    .map((entry) => {
      const daysSinceLastSeen = getDaysBetween(latestObservedAt, entry.lastSeen) || 0;
      let segment = "New";
      if (entry.orders >= 3 && daysSinceLastSeen <= 14) {
        segment = "Champion";
      } else if (entry.orders >= 2 && daysSinceLastSeen <= 21) {
        segment = "Repeat";
      } else if (daysSinceLastSeen >= 45) {
        segment = "Dormant";
      } else if (daysSinceLastSeen >= 21) {
        segment = "At Risk";
      }

      return {
        ...entry,
        averageOrderValue: entry.orders > 0 ? round(entry.paidRevenue / entry.orders) : 0,
        paidRate: entry.orders > 0 ? 100 : 0,
        firstSeen: entry.firstSeen ? entry.firstSeen.toISOString() : null,
        lastSeen: entry.lastSeen ? entry.lastSeen.toISOString() : null,
        daysSinceLastSeen,
        segment,
        topCategory:
          Object.entries(entry.categories).sort((left, right) => right[1] - left[1])[0]?.[0] || "General",
        leadChannel:
          Object.entries(entry.channels).sort((left, right) => right[1] - left[1])[0]?.[0] || "In-Store",
        leadPaymentMethod:
          Object.entries(entry.paymentMethods).sort((left, right) => right[1] - left[1])[0]?.[0] || "Card",
      };
    })
    .sort((left, right) => right.paidRevenue - left.paidRevenue || right.orders - left.orders);

  const namedRevenue = customers.reduce((sum, customer) => sum + customer.paidRevenue, 0);
  const repeatCustomers = customers.filter((customer) => customer.orders >= 2);
  const repeatRevenue = repeatCustomers.reduce((sum, customer) => sum + customer.paidRevenue, 0);

  customers = customers.map((customer) => {
    const customerShare = namedRevenue > 0 ? (customer.paidRevenue / namedRevenue) * 100 : 0;
    const cadenceDays =
      customer.orders > 1
        ? round(
            ((getDaysBetween(customer.lastSeen, customer.firstSeen) || 0) /
              Math.max(customer.orders - 1, 1)),
            1
          )
        : null;

    const relationshipStatus =
      customer.segment === "Champion"
        ? "Protect and deepen"
        : customer.segment === "Repeat"
          ? "Convert to champion"
          : customer.segment === "New"
            ? "Needs second visit"
            : customer.segment === "At Risk"
              ? "Follow up now"
              : "Recovery needed";

    const recommendedAction =
      customer.segment === "Champion"
        ? `Protect ${customer.customer} with follow-through around ${customer.topCategory}.`
        : customer.segment === "Repeat"
          ? `Push ${customer.customer} toward champion status with the next ${customer.topCategory} offer.`
          : customer.segment === "New"
            ? `Turn ${customer.customer} into a second-visit account before the relationship cools.`
            : `Reach out to ${customer.customer} now before ${formatMoney(customer.paidRevenue, context.currency)} cools further.`;

    return {
      ...customer,
      cadenceDays,
      customerShare: round(customerShare, 1),
      pressureTone:
        customer.segment === "Dormant"
          ? "danger"
          : customer.segment === "At Risk"
            ? "warning"
            : customer.segment === "New"
              ? "neutral"
              : "success",
      relationshipStatus,
      spendTier: customerShare >= 30 ? "Anchor" : customerShare >= 18 ? "Core" : customer.segment === "New" ? "Emerging" : "Developing",
      watchSummary:
        customer.segment === "Champion"
          ? `${customer.orders} paid orders and ${formatMoney(customer.paidRevenue, context.currency)} anchored by ${customer.topCategory}.`
          : customer.segment === "Repeat"
            ? `${customer.orders} paid orders with ${formatMoney(customer.paidRevenue, context.currency)} already showing repeat depth.`
            : customer.segment === "New"
              ? `Only ${customer.orders} named paid order is on record so far.`
              : `${customer.daysSinceLastSeen} days since the last visit with ${formatMoney(customer.paidRevenue, context.currency)} now exposed.`,
      recommendedAction,
    };
  });

  const topCustomer = customers[0] || null;
  const topCustomerShare = namedRevenue > 0 ? (toNumber(topCustomer?.paidRevenue) / namedRevenue) * 100 : 0;
  const walkInRevenueShare = paidRevenue > 0 ? (walkInRevenue / paidRevenue) * 100 : 0;
  const repeatCustomerRate = customers.length > 0 ? (repeatCustomers.length / customers.length) * 100 : 0;
  const atRiskCustomers = customers
    .filter((customer) => ["At Risk", "Dormant"].includes(customer.segment))
    .sort((left, right) => right.daysSinceLastSeen - left.daysSinceLastSeen || right.paidRevenue - left.paidRevenue)
    .slice(0, 5);
  const growingCustomers = customers
    .filter((customer) => ["Champion", "Repeat", "New"].includes(customer.segment))
    .sort((left, right) => right.paidRevenue - left.paidRevenue)
    .slice(0, 5);
  const coolingRevenue = atRiskCustomers.reduce((sum, customer) => sum + customer.paidRevenue, 0);
  const segmentMix = [
    { label: "Champion", value: customers.filter((item) => item.segment === "Champion").length, fill: "#16a34a" },
    { label: "Repeat", value: customers.filter((item) => item.segment === "Repeat").length, fill: "#2563eb" },
    { label: "New", value: customers.filter((item) => item.segment === "New").length, fill: "#0f766e" },
    { label: "At Risk", value: customers.filter((item) => item.segment === "At Risk").length, fill: "#f59e0b" },
    { label: "Dormant", value: customers.filter((item) => item.segment === "Dormant").length, fill: "#dc2626" },
  ];
  const strongestSegment = [...segmentMix].sort((left, right) => right.value - left.value)[0] || null;
  const executive = buildCustomerExecutive(
    {
      totalCustomers: customers.length,
      namedRevenue,
      walkInRevenueShare,
      repeatCustomerRate,
    },
    topCustomer,
    topCustomerShare,
    repeatCustomers,
    context.currency
  );
  const watchtower = [...new Map(
    [...atRiskCustomers, ...customers.slice(0, 4)].map((customer) => [
      customer.customer,
      {
        customer: customer.customer,
        tone: customer.pressureTone,
        headline: customer.watchSummary,
        action: customer.recommendedAction,
        metric: `${customer.segment} / ${customer.daysSinceLastSeen}d since last seen / ${formatMoney(customer.paidRevenue, context.currency)}`,
      },
    ])
  ).values()].slice(0, 4);

  return {
    summary: {
      totalCustomers: customers.length,
      namedRevenue: round(namedRevenue),
      namedRevenueShare: paidRevenue > 0 ? round((namedRevenue / paidRevenue) * 100, 1) : 0,
      repeatCustomerRate: round(repeatCustomerRate, 1),
      repeatRevenue: round(repeatRevenue),
      walkInRevenue: round(walkInRevenue),
      walkInRevenueShare: round(walkInRevenueShare, 1),
      topCustomerShare: round(topCustomerShare, 1),
      topCustomer: topCustomer?.customer || "No clear leader yet",
      championCount: segmentMix.find((item) => item.label === "Champion")?.value || 0,
      repeatCount: segmentMix.find((item) => item.label === "Repeat")?.value || 0,
      newCount: segmentMix.find((item) => item.label === "New")?.value || 0,
      atRiskCount: segmentMix.find((item) => item.label === "At Risk")?.value || 0,
      dormantCount: segmentMix.find((item) => item.label === "Dormant")?.value || 0,
      coolingRevenue: round(coolingRevenue),
      averageDaysSinceLastSeen:
        customers.length > 0
          ? round(
              customers.reduce((sum, customer) => sum + toNumber(customer.daysSinceLastSeen), 0) /
                customers.length,
              1
            )
          : 0,
      strongestSegment: strongestSegment?.label || "Still forming",
    },
    executiveSummary: {
      ...executive,
      whyItMattersPoints: [
        `${formatPercent(walkInRevenueShare)} of paid revenue is still anonymous walk-in demand.`,
        repeatRevenue > 0
          ? `Repeat demand already contributes ${formatMoney(repeatRevenue, context.currency)} across ${repeatCustomers.length} returning customers.`
          : "Repeat demand is still too light to anchor the business.",
        topCustomer
          ? `${topCustomer.customer} is carrying ${formatPercent(topCustomerShare)} of named revenue.`
          : "No lead named account is standing out yet.",
      ],
      whatChangedPoints: [
        `${customers.length} named customers are visible in the live sales history.`,
        namedRevenue > 0
          ? `Named customers are driving ${formatMoney(namedRevenue, context.currency)} of paid revenue.`
          : "Named revenue is still too thin to defend.",
        strongestSegment
          ? `${strongestSegment.label} is the heaviest visible customer segment at ${strongestSegment.value} accounts.`
          : "Customer mix is still forming.",
      ],
      actionPlan: [
        topCustomer?.recommendedAction,
        atRiskCustomers[0]?.recommendedAction,
        customers.find((customer) => customer.segment === "New")?.recommendedAction,
      ].filter(Boolean).slice(0, 3),
      actions: [
        {
          label: "Review customer momentum",
          note: "See how named, walk-in, and repeat demand are moving.",
          focus: "customers-momentum",
        },
        {
          label: "Inspect the customer directory",
          note: "Open the strongest accounts and their current segment.",
          focus: "customers-directory",
        },
        {
          label: "Check the retention watchlist",
          note: "See which customers are cooling off and need follow-through.",
          focus: "customers-retention",
        },
      ],
    },
    actionSignals: [
      {
        title: "Walk-In Dependence",
        value: formatPercent(walkInRevenueShare),
        message:
          walkInRevenueShare >= 70
            ? "Too much paid revenue is still anonymous."
            : "Known demand is becoming easier to defend.",
        tone: walkInRevenueShare >= 70 ? "warning" : "success",
        focus: "customers-momentum",
      },
      {
        title: "Repeat Revenue",
        value: formatMoney(repeatRevenue, context.currency),
        message:
          repeatRevenue > 0
            ? "Returning customers are starting to anchor the business."
            : "Repeat demand is still too light to carry the business.",
        tone: repeatRevenue > 0 ? "success" : "warning",
        focus: "customers-retention",
      },
      {
        title: "Lead Customer",
        value: topCustomer?.customer || "No leader yet",
        message: topCustomer
          ? `${topCustomer.orders} orders with ${topCustomer.daysSinceLastSeen} days since the last visit.`
          : "The lead customer signal sharpens as more named orders land.",
        tone: topCustomer ? "success" : "warning",
        focus: "customers-directory",
      },
      {
        title: "At-Risk Accounts",
        value: atRiskCustomers.length > 0 ? formatMoney(coolingRevenue, context.currency) : formatMoney(0, context.currency),
        message:
          atRiskCustomers.length > 0
            ? "Named customers are cooling off and deserve follow-up attention."
            : "No named account is cooling off hard enough to flag right now.",
        tone: atRiskCustomers.length > 0 ? "warning" : "success",
        focus: "customers-retention",
      },
    ],
    trend: buildCustomerTrend(range, context.sales, context.latestObservedAt),
    segmentMix,
    customers,
    topCustomers: customers.slice(0, 6),
    atRiskCustomers,
    growingCustomers,
    watchtower,
  };
}

function getSuppliersDataset(range = "monthly", context = getAnalyticsContext()) {
  void range;
  const inventoryIntel = getInventoryIntelligence(context);
  const supplierEntries = {};
  const now = context.latestObservedAt;

  function ensureSupplier(name) {
    const supplier = String(name || "General Supplier").trim() || "General Supplier";
    if (!supplierEntries[supplier]) {
      supplierEntries[supplier] = {
        supplier,
        skuCount: 0,
        unitsOnHand: 0,
        inventoryValue: 0,
        lowStockLines: 0,
        criticalLines: 0,
        openPoCount: 0,
        openPoValue: 0,
        openUnits: 0,
        totalPoCount: 0,
        lateOrders: 0,
        unitsOrdered: 0,
        unitsReceived: 0,
        leadTimes: [],
        lastDeliveryAt: null,
        exposedSkuCount: 0,
        exposedInventoryValue: 0,
        topExposure: null,
      };
    }
    return supplierEntries[supplier];
  }

  context.products.forEach((product) => {
    const entry = ensureSupplier(product.supplier);
    const stock = toNumber(product.stock);
    const stockValue = stock * toNumber(product.unitCost);
    entry.skuCount += 1;
    entry.unitsOnHand += stock;
    entry.inventoryValue += stockValue;
    if (stock > 0 && stock <= getLowStockThreshold(context.settings)) entry.lowStockLines += 1;
    if (stock <= Math.max(1, Math.floor(getLowStockThreshold(context.settings) / 2))) entry.criticalLines += 1;
  });

  inventoryIntel.reorderNow.forEach((product) => {
    const entry = ensureSupplier(product.supplier);
    entry.exposedSkuCount += 1;
    entry.exposedInventoryValue += product.stockValue;
    if (!entry.topExposure || product.urgencyScore > entry.topExposure.urgencyScore) {
      entry.topExposure = {
        id: product.id,
        name: product.name,
        sku: product.sku,
        category: product.category,
        stock: product.stock,
        stockValue: product.stockValue,
        estimatedDaysCover: product.estimatedDaysCover,
        urgencyScore: product.urgencyScore,
        status: product.status,
      };
    }
  });

  context.purchaseOrders.forEach((order) => {
    const entry = ensureSupplier(order.supplier);
    const status = String(order.status || "Draft").trim();
    entry.totalPoCount += 1;
    entry.unitsOrdered += toNumber(order.unitsOrdered);
    entry.unitsReceived += toNumber(order.unitsReceived);

    if (!["Received", "Cancelled"].includes(status)) {
      entry.openPoCount += 1;
      entry.openPoValue += toNumber(order.totalEstimatedCost);
      entry.openUnits += toNumber(order.openUnits);
    }

    if (order.expectedDateObj && !["Received", "Cancelled"].includes(status) && order.expectedDateObj < now) {
      entry.lateOrders += 1;
    }

    if (order.receivedAtObj) {
      if (!entry.lastDeliveryAt || order.receivedAtObj > entry.lastDeliveryAt) {
        entry.lastDeliveryAt = order.receivedAtObj;
      }
      if (order.sentAtObj || order.createdAtObj) {
        const leadTime = getDaysBetween(order.receivedAtObj, order.sentAtObj || order.createdAtObj);
        if (leadTime !== null) {
          entry.leadTimes.push(leadTime);
        }
      }
    }
  });

  const suppliers = Object.values(supplierEntries)
    .map((entry) => {
      const fillRate = entry.unitsOrdered > 0 ? (entry.unitsReceived / entry.unitsOrdered) * 100 : 0;
      const avgLeadTimeDays =
        entry.leadTimes.length > 0
          ? entry.leadTimes.reduce((sum, value) => sum + value, 0) / entry.leadTimes.length
          : 0;
      const serviceScore = clamp(
        100 -
          entry.criticalLines * 16 -
          entry.lateOrders * 14 -
          Math.max(0, 85 - fillRate) * 0.6 -
          Math.max(0, avgLeadTimeDays - 5) * 3,
        22,
        100
      );
      let pressureTone = "success";
      let status = "Stable";

      if (entry.criticalLines > 0 && entry.openPoCount === 0) {
        pressureTone = "danger";
        status = "Uncovered";
      } else if (entry.lateOrders > 0 || fillRate > 0 && fillRate < 82 || entry.lowStockLines > 0) {
        pressureTone = "warning";
        status = "Watch";
      }

      return {
        ...entry,
        fillRate: round(fillRate, 1),
        avgLeadTimeDays: round(avgLeadTimeDays, 1),
        serviceScore: round(serviceScore, 0),
        pressureTone,
        status,
        lastDeliveryAt: entry.lastDeliveryAt ? entry.lastDeliveryAt.toISOString() : null,
        riskScore: round(
          entry.criticalLines * 22 +
            entry.lowStockLines * 8 +
            entry.lateOrders * 16 +
            Math.max(0, 90 - fillRate) * 0.6 +
            Math.max(0, avgLeadTimeDays - 5) * 2 +
            (entry.openPoCount === 0 && entry.lowStockLines > 0 ? 16 : 0),
          1
        ),
        pressureReasons: [
          entry.topExposure
            ? `${entry.topExposure.name} is the most exposed SKU with ${entry.topExposure.stock} units left.`
            : null,
          entry.criticalLines > 0 && entry.openPoCount === 0
            ? `${entry.criticalLines} critical lines have no inbound cover right now.`
            : null,
          entry.lateOrders > 0 ? `${entry.lateOrders} commitments are already past expected receipt.` : null,
          fillRate > 0 && fillRate < 82 ? `Fill rate is only ${fillRate.toFixed(1)}% across tracked ordered units.` : null,
        ].filter(Boolean),
      };
    })
    .sort((left, right) => right.riskScore - left.riskScore || right.openPoValue - left.openPoValue);

  const weightedFillRate =
    suppliers.reduce((sum, supplier) => sum + supplier.unitsOrdered, 0) > 0
      ? (suppliers.reduce((sum, supplier) => sum + supplier.unitsReceived, 0) /
          suppliers.reduce((sum, supplier) => sum + supplier.unitsOrdered, 0)) *
        100
      : 0;
  const averageLeadTime =
    suppliers.filter((supplier) => supplier.avgLeadTimeDays > 0).length > 0
      ? suppliers
          .filter((supplier) => supplier.avgLeadTimeDays > 0)
          .reduce((sum, supplier) => sum + supplier.avgLeadTimeDays, 0) /
        suppliers.filter((supplier) => supplier.avgLeadTimeDays > 0).length
      : 0;
  const openCommitmentValue = suppliers.reduce((sum, supplier) => sum + supplier.openPoValue, 0);
  const atRiskSuppliers = suppliers.filter((supplier) => supplier.pressureTone !== "success");
  const leadSupplier = suppliers[0] || null;
  const openPoCount = suppliers.reduce((sum, supplier) => sum + supplier.openPoCount, 0);
  const lateCommitments = suppliers.reduce((sum, supplier) => sum + supplier.lateOrders, 0);
  const uncoveredCriticalLines = suppliers.reduce(
    (sum, supplier) => sum + (supplier.criticalLines > 0 && supplier.openPoCount === 0 ? supplier.criticalLines : 0),
    0
  );
  const exposedSkuCount = suppliers.reduce((sum, supplier) => sum + supplier.exposedSkuCount, 0);
  const serviceScore =
    suppliers.length > 0
      ? suppliers.reduce((sum, supplier) => sum + supplier.serviceScore, 0) / suppliers.length
      : 0;

  let statusTone = "success";
  let headline = "Supplier cover is stable enough to operate cleanly.";
  let summary =
    suppliers.length > 0
      ? `${suppliers.length} suppliers are active and ${formatMoney(openCommitmentValue, context.currency)} is still sitting in open purchase orders.`
      : "Supplier intelligence is still thin because supplier-linked stock and purchase-order history are light.";
  let whyItMatters =
    "Supplier quality determines whether planned replenishment becomes real stock on the shelf.";
  let nextMove = leadSupplier
    ? `Close the biggest open commitment with ${leadSupplier.supplier} before exposed SKUs turn into floor breaks.`
    : "Keep supplier records consistent on products and purchase orders.";

  if (!suppliers.length) {
    statusTone = "warning";
    headline = "Supplier intelligence is still empty.";
  } else if (leadSupplier?.pressureTone === "danger") {
    statusTone = "danger";
    headline = "Supplier pressure is already touching stock continuity.";
    summary = `${leadSupplier.supplier} is carrying ${leadSupplier.lowStockLines} low-stock lines with ${leadSupplier.openPoCount} open commitments and ${leadSupplier.lateOrders} late orders.`;
    nextMove =
      leadSupplier.openPoCount > 0
        ? `Chase receiving follow-through with ${leadSupplier.supplier} before exposed SKUs fall through.`
        : `Raise an immediate replenishment call with ${leadSupplier.supplier}.`;
  } else if (weightedFillRate > 0 && weightedFillRate < 82) {
    statusTone = "warning";
    headline = "Suppliers are shipping, but fill quality is soft.";
    summary = `Weighted fill rate is ${weightedFillRate.toFixed(1)}% and ${formatMoney(openCommitmentValue, context.currency)} is still waiting to land.`;
    nextMove = "Close the biggest open commitments and tighten follow-up on partial receipts.";
  }

  return {
    summary: {
      supplierCount: suppliers.length,
      openCommitmentValue: round(openCommitmentValue),
      weightedFillRate: round(weightedFillRate, 1),
      averageLeadTime: round(averageLeadTime, 1),
      atRiskSuppliers: atRiskSuppliers.length,
      leadSupplier: leadSupplier?.supplier || "No clear watchpoint",
      openPoCount,
      lateCommitments,
      uncoveredCriticalLines,
      exposedSkuCount,
      serviceScore: round(serviceScore, 1),
    },
    executiveSummary: {
      statusTone,
      headline,
      summary,
      whyItMatters,
      nextMove,
      whyItMattersPoints: [
        leadSupplier
          ? `${leadSupplier.supplier} is carrying ${leadSupplier.lowStockLines} low-stock lines and ${leadSupplier.exposedSkuCount} exposed SKUs.`
          : "Supplier-linked inventory pressure is still building.",
        openCommitmentValue > 0
          ? `${openPoCount} open commitments are still outside received stock.`
          : "There is no open commitment backlog right now.",
        uncoveredCriticalLines > 0
          ? `${uncoveredCriticalLines} critical supplier lines currently have no inbound cover attached.`
          : "Critical supplier lines are not broadly uncovered right now.",
      ].filter(Boolean),
      whatChangedPoints: [
        weightedFillRate > 0
          ? `Weighted fill rate is ${weightedFillRate.toFixed(1)}% across tracked receipts.`
          : "Fill-rate history will sharpen as more purchase orders are received.",
        lateCommitments > 0
          ? `${lateCommitments} commitments are already late and need follow-through.`
          : "No late supplier commitments are visible right now.",
        atRiskSuppliers.length > 0
          ? `${atRiskSuppliers.length} suppliers are on watch because of stock, fill, or receiving pressure.`
          : "No supplier is under broad pressure right now.",
      ],
      actionPlan: suppliers.slice(0, 3).map((supplier) => {
        if (supplier.criticalLines > 0 && supplier.openPoCount === 0) {
          return `Raise an immediate replenishment call with ${supplier.supplier} and protect ${supplier.topExposure?.name || "the exposed SKU"} first.`;
        }
        if (supplier.lateOrders > 0) {
          return `Follow up on the late commitments with ${supplier.supplier} and confirm revised receipt timing today.`;
        }
        return `Close the biggest open commitment from ${supplier.supplier} before it turns into a floor issue.`;
      }).slice(0, 3),
      actions: [
        {
          label: "Review supplier service quality",
          note: "See fill-rate and open-value pressure by supplier.",
          focus: "suppliers-service",
        },
        {
          label: "Open the supplier directory",
          note: "Inspect who is stable, who is pressured, and what needs follow-through.",
          focus: "suppliers-directory",
        },
        {
          label: "Check open commitments",
          note: "Go straight to the biggest open purchase orders.",
          focus: "suppliers-open-orders",
        },
      ],
    },
    actionSignals: [
      {
        title: "Open Commitments",
        value: formatMoney(openCommitmentValue, context.currency),
        message:
          openCommitmentValue > 0
            ? "Purchase-order value is still sitting outside received stock."
            : "No supplier commitment is waiting to be received right now.",
        tone: openCommitmentValue > 0 ? "warning" : "success",
        focus: "suppliers-open-orders",
      },
      {
        title: "Tracked Fill Rate",
        value: formatPercent(weightedFillRate),
        message:
          weightedFillRate > 0
            ? "This is the cleanest read on how fully suppliers are landing what was ordered."
            : "Fill-rate history appears once received purchase orders build up.",
        tone: weightedFillRate > 0 && weightedFillRate < 82 ? "warning" : "success",
        focus: "suppliers-service",
      },
      {
        title: "Average Lead Time",
        value: `${averageLeadTime.toFixed(1)} days`,
        message:
          averageLeadTime > 0
            ? "Shorter lead times give the business more room before low-stock pressure turns urgent."
            : "Lead-time history appears once more orders are received.",
        tone: averageLeadTime > 8 ? "warning" : "success",
        focus: "suppliers-service",
      },
      {
        title: "Supplier Pressure",
        value: `${atRiskSuppliers.length}`,
        message:
          atRiskSuppliers.length > 0
            ? "Suppliers are already on watch because of stock, fill, or receiving pressure."
            : "No supplier is under meaningful pressure right now.",
        tone: atRiskSuppliers.length > 0 ? "warning" : "success",
        focus: "suppliers-directory",
      },
    ],
    watchtower: suppliers.slice(0, 4).map((supplier) => ({
      supplier: supplier.supplier,
      tone: supplier.pressureTone,
      headline: supplier.pressureReasons[0] || "No immediate supplier break is visible.",
      action:
        supplier.criticalLines > 0 && supplier.openPoCount === 0
          ? `Raise an immediate replenishment call with ${supplier.supplier}.`
          : supplier.lateOrders > 0
            ? `Follow up on late commitments with ${supplier.supplier}.`
            : `Close the biggest open commitment with ${supplier.supplier}.`,
      metric: `${supplier.lowStockLines} low-stock lines / ${supplier.openPoCount} open POs / ${supplier.serviceScore}/100 service`,
    })),
    suppliers,
    topSuppliers: suppliers.slice(0, 6),
    openOrders: context.purchaseOrders
      .filter((order) => !["Received", "Cancelled"].includes(String(order.status || "").trim()))
      .sort((left, right) => right.totalEstimatedCost - left.totalEstimatedCost)
      .slice(0, 6)
      .map((order) => ({
        id: order.id,
        supplier: order.supplier,
        status: order.status,
        value: round(order.totalEstimatedCost),
        openUnits: toNumber(order.openUnits),
        expectedDate: order.expectedDate || null,
      })),
  };
}

function getCustomerIntelligence(context = getAnalyticsContext()) {
  const customersDataset = getCustomersDataset("monthly", context);
  const namedOrders = customersDataset.customers.reduce((sum, customer) => sum + customer.orders, 0);
  const topCustomers = customersDataset.topCustomers.slice(0, 4).map((customer) => ({
    customer: customer.customer,
    orders: customer.orders,
    averageOrderValue: customer.averageOrderValue,
    revenue: customer.paidRevenue,
    segment: customer.segment,
  }));

  return {
    uniqueCustomers: customersDataset.summary.totalCustomers,
    namedOrders,
    namedRevenue: customersDataset.summary.namedRevenue,
    namedRevenueShare: customersDataset.summary.namedRevenueShare,
    repeatCustomerCount: customersDataset.summary.repeatCount + customersDataset.summary.championCount,
    repeatCustomerRate: customersDataset.summary.repeatCustomerRate,
    repeatRevenue: customersDataset.summary.repeatRevenue,
    topCustomer: topCustomers[0] || null,
    topCustomers,
  };
}

function getStaffingIntelligence(context = getAnalyticsContext()) {
  const activeUsers = context.users.filter((user) => String(user.status || "").trim() === "Active");
  const cashiers = activeUsers.filter((user) => String(user.role || "").trim() === "Cashier");
  const inventoryClerks = activeUsers.filter((user) => String(user.role || "").trim() === "Inventory Clerk");
  const managers = activeUsers.filter((user) => ["Manager", "Owner"].includes(String(user.role || "").trim()));
  const pendingApprovals = context.users.filter((user) => String(user.status || "").trim() !== "Active").length;
  const topCashier = getTopCashiers(1, context)[0] || null;
  const overview = getOverviewMetrics(context);
  const cashierDependence =
    topCashier && overview.paidRevenue > 0 ? (toNumber(topCashier.revenue) / overview.paidRevenue) * 100 : 0;

  const readinessScore = clamp(
    100 -
      (cashiers.length === 0 ? 35 : cashiers.length === 1 ? 18 : 0) -
      (inventoryClerks.length === 0 ? 24 : inventoryClerks.length === 1 ? 10 : 0) -
      (managers.length === 0 ? 18 : 0) -
      pendingApprovals * 6 -
      Math.max(0, cashierDependence - 45) * 0.8,
    22,
    100
  );

  let pressureTone = "success";
  let headline = "Roster coverage is stable enough to execute.";
  let summary = `${activeUsers.length} active staff accounts are covering the current operation.`;

  if (cashiers.length === 0 || inventoryClerks.length === 0) {
    pressureTone = "danger";
    headline = "Coverage gaps are already visible.";
    summary = "Checkout or inventory control has no active owner, so execution risk is immediate.";
  } else if (cashiers.length === 1 || inventoryClerks.length === 1 || pendingApprovals > 0 || cashierDependence >= 45) {
    pressureTone = "warning";
    headline = "The roster can operate, but it is still too concentrated.";
    summary = `${cashiers.length} cashiers and ${inventoryClerks.length} inventory clerks are active, but dependency or approval backlog is still visible.`;
  }

  return {
    readinessScore: round(readinessScore, 0),
    pressureTone,
    headline,
    summary,
    activeStaff: activeUsers.length,
    totalStaff: context.users.length,
    pendingApprovals,
    cashiers: cashiers.length,
    inventoryClerks: inventoryClerks.length,
    managers: managers.length,
    cashierDependence: round(cashierDependence, 1),
    topCashier: topCashier?.cashier || null,
  };
}

function getBusinessPulse(range = "monthly", context = getAnalyticsContext()) {
  const reports = getReportsDataset(range, context);
  const inventoryIntel = getInventoryIntelligence(context);
  return [
    {
      label: "Recognized revenue",
      value: formatMoney(reports.summary.totalRevenue, context.currency),
      note: `${reports.summary.paidOrders} paid orders are grounding this view.`,
      tone: reports.summary.totalRevenue > 0 ? "success" : "neutral",
    },
    {
      label: "Cash at risk",
      value: formatMoney(reports.summary.pendingRevenue + reports.summary.declinedRevenue, context.currency),
      note: `${reports.summary.pendingOrders + reports.summary.declinedOrders} orders are outside paid capture.`,
      tone: reports.summary.pendingRevenue + reports.summary.declinedRevenue > 0 ? "warning" : "success",
    },
    {
      label: "Runout queue",
      value: `${inventoryIntel.reorderNow.length}`,
      note: inventoryIntel.reorderNow[0]
        ? `${inventoryIntel.reorderNow[0].name} is the lead stock risk.`
        : "No immediate stock break is visible right now.",
      tone: inventoryIntel.reorderNow.length > 0 ? "warning" : "success",
    },
  ];
}

function getDashboardDecisionModel(context = getAnalyticsContext()) {
  const reports = getReportsDataset("monthly", context);
  const inventoryIntel = getInventoryIntelligence(context);
  const customerIntelligence = getCustomerIntelligence(context);
  const staffingIntelligence = getStaffingIntelligence(context);
  const strongestWindow = [...getDaypartPerformance(context)].sort((left, right) => right.revenue - left.revenue)[0] || null;
  const nextProjection = reports.forecast[0]?.revenue || 0;
  const lastActual = reports.trend[reports.trend.length - 1]?.revenue || 0;
  const growthToProjection =
    lastActual > 0 ? ((nextProjection - lastActual) / lastActual) * 100 : nextProjection > 0 ? 100 : 0;
  const runoutQueue = inventoryIntel.reorderNow.slice(0, 3);
  const runoutExposure = runoutQueue.reduce(
    (sum, item) => sum + toNumber(item.recentRevenue || item.revenue),
    0
  );
  const overview = getOverviewMetrics(context);

  let statusTone = "success";
  let headline = "The store is generating a clean operating picture.";
  let summary =
    `${formatMoney(overview.paidRevenue, context.currency)} has been captured across ${overview.paidOrders} paid orders, and the live dashboard can now see revenue, stock, and customer quality together.`;
  let whyItMatters =
    "When cash capture, stock risk, and customer behavior are visible in one place, the owner can act faster and with fewer blind spots.";
  let nextMove =
    runoutQueue[0]
      ? `Protect ${runoutQueue[0].name} first, then keep the strongest revenue window free of stock friction.`
      : "Protect cash quality first, then deepen the strongest demand line.";

  if (overview.pendingRevenue + overview.declinedRevenue > overview.paidRevenue * 0.2 && overview.paidRevenue > 0) {
    statusTone = "warning";
    headline = "Demand is coming in, but too much of it is not converting to usable cash.";
    summary = `${formatMoney(overview.pendingRevenue + overview.declinedRevenue, context.currency)} is currently stuck outside paid capture, which is weakening the business picture.`;
    whyItMatters =
      "If demand is not turning into paid orders, it cannot reliably fund inventory and operating moves.";
    nextMove = "Work the pending and declined queue before chasing more top-line growth.";
  } else if (runoutQueue[0] && runoutQueue[0].stock <= 0) {
    statusTone = "danger";
    headline = "A live stock break is already threatening the next revenue step.";
    summary = `${runoutQueue[0].name} is out of stock while it is still contributing to recent sales momentum.`;
    whyItMatters =
      "When the lead product breaks stock, conversion and customer trust fall together.";
    nextMove = `Restore cover on ${runoutQueue[0].name} immediately and confirm the inbound plan with ${runoutQueue[0].supplier}.`;
  } else if (reports.summary.profitCoverageRate < 95) {
    statusTone = "warning";
    headline = "Revenue is real, but margin visibility still has blind spots.";
    summary = `${formatMoney(reports.summary.uncostedRevenue, context.currency)} of paid revenue is still missing stored unit cost, so gross profit is only partially measured.`;
    whyItMatters =
      "Without cost coverage, the owner cannot trust which categories and products are actually the most profitable.";
    nextMove = "Close the unit-cost capture gap on the SKUs still coming through without procurement cost.";
  }

  return {
    dailyBriefing: {
      statusTone,
      headline,
      summary,
      whyItMatters,
      nextMove,
      actions: [
        {
          label: "Review cash quality",
          note: "Open the paid vs pending vs declined revenue pulse.",
          focus: "dashboard-cash-pulse",
        },
        {
          label: "Protect inventory continuity",
          note: "Go straight to the low-stock queue and the next likely runout.",
          focus: "dashboard-low-stock",
        },
        {
          label: "Inspect demand drivers",
          note: "See which categories and products are carrying the current revenue picture.",
          focus: "dashboard-demand-drivers",
        },
      ],
      contextCards: [
        {
          label: "Captured Revenue",
          value: formatMoney(overview.paidRevenue, context.currency),
          note: `${overview.paidOrders} paid orders are in the current data set.`,
        },
        {
          label: "Cash At Risk",
          value: formatMoney(overview.pendingRevenue + overview.declinedRevenue, context.currency),
          note: `${overview.pendingOrders + overview.declinedOrders} orders still need conversion or recovery.`,
        },
        {
          label: "Runout Queue",
          value: `${inventoryIntel.reorderNow.length}`,
          note: runoutQueue[0]
            ? `${runoutQueue[0].name} is the lead stock risk.`
            : "No immediate stock break is visible.",
        },
        {
          label: "Named Demand",
          value: formatPercent(customerIntelligence.namedRevenueShare),
          note: `${customerIntelligence.uniqueCustomers} named customers are visible in the live history.`,
        },
      ],
    },
    whatChanged: [
      {
        label: "Cash Capture",
        value: formatPercent(overview.paidRate),
        note: `${overview.paidOrders} of ${overview.totalOrders} orders are paid.`,
        tone: overview.paidRate >= 80 ? "success" : "warning",
        focus: "dashboard-cash-pulse",
      },
      {
        label: "Cash Exposure",
        value: formatMoney(overview.pendingRevenue + overview.declinedRevenue, context.currency),
        note: `${overview.pendingOrders + overview.declinedOrders} orders are outside paid capture.`,
        tone: overview.pendingRevenue + overview.declinedRevenue > 0 ? "warning" : "success",
        focus: "dashboard-cash-pulse",
      },
      {
        label: "Runout Queue",
        value: `${inventoryIntel.reorderNow.length}`,
        note: runoutQueue[0]
          ? `${runoutQueue[0].name} is the lead continuity risk.`
          : "No immediate stock break is visible.",
        tone: inventoryIntel.reorderNow.length > 0 ? "warning" : "success",
        focus: "dashboard-low-stock",
      },
      {
        label: "Margin Coverage",
        value: formatPercent(reports.summary.profitCoverageRate),
        note: `${formatMoney(reports.summary.uncostedRevenue, context.currency)} of paid revenue still lacks unit cost.`,
        tone: reports.summary.profitCoverageRate < 95 ? "warning" : "success",
        focus: "dashboard-demand-drivers",
      },
    ],
    smartAlerts: [
      {
        label: "Cash Recovery",
        value: formatMoney(overview.pendingRevenue + overview.declinedRevenue, context.currency),
        note: "Pending and declined orders are the fastest cash-quality fix available right now.",
        tone: overview.pendingRevenue + overview.declinedRevenue > 0 ? "warning" : "success",
        focus: "dashboard-cash-pulse",
      },
      {
        label: "Low Stock",
        value: `${overview.lowStockCount}`,
        note:
          runoutQueue[0]
            ? `${runoutQueue[0].name} is carrying the sharpest stock pressure.`
            : "No product is currently breaking the low-stock threshold.",
        tone: overview.lowStockCount > 0 ? "warning" : "success",
        focus: "dashboard-low-stock",
      },
      {
        label: "Customer Quality",
        value: formatPercent(customerIntelligence.repeatCustomerRate),
        note: "Repeat customer rate shows whether named demand is becoming defensible.",
        tone: customerIntelligence.repeatCustomerRate >= 30 ? "success" : "warning",
        focus: "dashboard-customer-intelligence",
      },
    ],
    recommendations: [
      {
        label: "Recover stuck cash",
        value: formatMoney(overview.pendingRevenue + overview.declinedRevenue, context.currency),
        note: "Work the orders still outside paid capture before pushing more demand.",
        tone: overview.pendingRevenue + overview.declinedRevenue > 0 ? "warning" : "success",
        focus: "dashboard-cash-pulse",
      },
      {
        label: "Protect the lead demand line",
        value: runoutQueue[0]?.name || "No exposed SKU",
        note: runoutQueue[0]
          ? `${runoutQueue[0].stock} units left with ${runoutQueue[0].estimatedDaysCover ?? "unmeasured"} days of cover.`
          : "The current stock picture is not showing an exposed lead SKU.",
        tone: runoutQueue[0] ? "warning" : "success",
        focus: "dashboard-low-stock",
      },
      {
        label: "Workforce readiness",
        value: `${staffingIntelligence.readinessScore}/100`,
        note: staffingIntelligence.summary,
        tone: staffingIntelligence.pressureTone,
        focus: "dashboard-workforce-readiness",
      },
    ],
    customerIntelligence,
    staffingIntelligence,
    forecastSignals: {
      nextProjection: round(nextProjection),
      growthToProjection: round(growthToProjection, 1),
      strongestWindow,
      runoutQueue,
      runoutExposure: round(runoutExposure),
    },
    scenarioDefaults: {
      basketLift: 5,
      recoveryRate: overview.pendingRevenue + overview.declinedRevenue > 0 ? 35 : 20,
      stockProtectionRate: inventoryIntel.reorderNow.length > 0 ? 30 : 20,
    },
  };
}

module.exports = {
  getAnalyticsContextAsync,
  getNormalizedSales,
  getOverviewMetrics,
  getSalesTrend,
  getStatusTrend,
  getStatusBreakdown,
  getRevenueByStatus,
  getPaymentMethodBreakdown,
  getChannelBreakdown,
  getDaypartPerformance,
  getTopCashiers,
  getCategoryValueData,
  getInventorySignals,
  getInventoryIntelligence,
  getBusinessPulse,
  getCategoryBreakdownFromSales: buildCategoryBreakdownFromSales,
  getTopProducts: buildTopProducts,
  generateInsights,
  generateForecast: buildForecast,
  getReportsDataset,
  getCustomersDataset,
  getSuppliersDataset,
  getCustomerIntelligence,
  getStaffingIntelligence,
  getDashboardDecisionModel,
};
