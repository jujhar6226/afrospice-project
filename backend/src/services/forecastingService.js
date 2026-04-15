const analyticsService = require("./analyticsService");

const DEFAULT_HORIZON_BY_RANGE = {
  daily: 14,
  weekly: 8,
  monthly: 4,
  yearly: 2,
};

const MAX_HORIZON_BY_RANGE = {
  daily: 30,
  weekly: 12,
  monthly: 6,
  yearly: 4,
};

const DEFAULT_SKU_LIMIT = 8;
const HISTORY_DAYS = 84;
const DEFAULT_LEAD_TIME_DAYS = 7;
const SERVICE_LEVEL_Z = 1.28;
const DEFAULT_LOW_STOCK_THRESHOLD = 10;
const SPARSE_HISTORY_OBSERVED_DAYS = 6;
const SPARSE_HISTORY_UNITS = 12;
const INTERMITTENT_ZERO_RATIO = 0.72;
const CATEGORY_FALLBACK_BASE_BLEND = 0.28;
const CATEGORY_FALLBACK_MAX_BLEND = 0.62;
const INTERMITTENT_BLEND = 0.35;
const STOCKOUT_INTEGRITY_ADJUSTMENT = 0.18;
const STOCKOUT_SUPPLIER_ADJUSTMENT = 0.14;
const CONFIDENCE_INTEGRITY_PENALTY = 10;
const CONFIDENCE_SUPPLIER_PENALTY = 9;
const SERVICE_LEVELS_BY_POLICY = {
  protect: { targetPct: 97, z: 1.88 },
  staple: { targetPct: 95, z: 1.65 },
  standard: { targetPct: 90, z: 1.28 },
  cautious: { targetPct: 84, z: 0.99 },
};

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

function mean(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + toNumber(value), 0) / values.length;
}

function standardDeviation(values = []) {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (toNumber(value) - avg) ** 2, 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}

function percentile(values = [], ratio = 0.9) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.floor((ordered.length - 1) * clamp(ratio, 0, 1)))
  );
  return ordered[index];
}

function normalCdf(value) {
  const x = toNumber(value);
  const sign = x < 0 ? -1 : 1;
  const absolute = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * absolute);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-(absolute ** 2)));
  return 0.5 * (1 + sign * erf);
}

function getWeekdayIndex(date) {
  const day = new Date(date).getDay();
  return day === 0 ? 6 : day - 1;
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
  const copy = startOfDay(date);
  copy.setDate(1);
  return copy;
}

function startOfYear(date) {
  const copy = startOfDay(date);
  copy.setMonth(0, 1);
  return copy;
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
  return copy;
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

function getRangeStepDays(range) {
  switch (range) {
    case "daily":
      return 1;
    case "weekly":
      return 7;
    case "yearly":
      return 365;
    case "monthly":
    default:
      return 30;
  }
}

function formatBucketLabel(date, range) {
  switch (range) {
    case "daily":
      return date.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
    case "weekly":
      return `Week of ${date.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`;
    case "yearly":
      return String(date.getFullYear());
    case "monthly":
    default:
      return date.toLocaleDateString("en-CA", { year: "numeric", month: "short" });
  }
}

function getDateKey(date) {
  const resolved = safeDate(date);
  if (!resolved) return "";
  return startOfDay(resolved).toISOString().slice(0, 10);
}

function fitHoltLinear(series = [], alpha = 0.45, beta = 0.2) {
  const cleaned = series.map((value) => Math.max(0, toNumber(value)));

  if (!cleaned.length) {
    return {
      level: 0,
      trend: 0,
      fitted: [],
    };
  }

  let level = cleaned[0];
  let trend = cleaned.length > 1 ? cleaned[1] - cleaned[0] : 0;
  const fitted = [level];

  for (let index = 1; index < cleaned.length; index += 1) {
    const observed = cleaned[index];
    const previousLevel = level;
    level = alpha * observed + (1 - alpha) * (level + trend);
    trend = beta * (level - previousLevel) + (1 - beta) * trend;
    fitted.push(Math.max(0, previousLevel + trend));
  }

  return {
    level,
    trend,
    fitted,
  };
}

function forecastHoltLinear(series = [], horizon = 1, alpha = 0.45, beta = 0.2) {
  const model = fitHoltLinear(series, alpha, beta);
  return Array.from({ length: horizon }, (_, index) =>
    Math.max(0, model.level + model.trend * (index + 1))
  );
}

function calculateWape(actual = [], predicted = []) {
  if (!actual.length || actual.length !== predicted.length) {
    return null;
  }

  const absoluteError = actual.reduce(
    (sum, value, index) => sum + Math.abs(toNumber(value) - toNumber(predicted[index])),
    0
  );
  const actualTotal = actual.reduce((sum, value) => sum + Math.abs(toNumber(value)), 0);

  if (actualTotal <= 0) {
    const baseline = Math.max(1, mean(actual));
    return round((absoluteError / (actual.length * baseline)) * 100, 1);
  }

  return round((absoluteError / actualTotal) * 100, 1);
}

function getResidualScale(actual = [], fitted = [], minimum = 1) {
  if (!actual.length || actual.length !== fitted.length) {
    return minimum;
  }

  const residuals = actual.map((value, index) => toNumber(value) - toNumber(fitted[index]));
  return Math.max(minimum, standardDeviation(residuals));
}

function buildDailySeasonality(context) {
  const sales = analyticsService
    .getNormalizedSales(context)
    .filter((sale) => String(sale.status || "").trim() === "Paid");
  const revenueTotals = Array.from({ length: 7 }, () => 0);
  const orderTotals = Array.from({ length: 7 }, () => 0);
  const counts = Array.from({ length: 7 }, () => 0);

  sales.forEach((sale) => {
    const date = safeDate(sale.date || sale.createdAt);
    if (!date) return;

    const index = getWeekdayIndex(date);
    revenueTotals[index] += toNumber(sale.total);
    orderTotals[index] += 1;
    counts[index] += 1;
  });

  const revenueAverages = revenueTotals.map((total, index) =>
    counts[index] > 0 ? total / counts[index] : 0
  );
  const orderAverages = orderTotals.map((total, index) =>
    counts[index] > 0 ? total / counts[index] : 0
  );
  const overallRevenueAverage = mean(revenueAverages.filter((value) => value > 0));
  const overallOrderAverage = mean(orderAverages.filter((value) => value > 0));

  return {
    revenue: revenueAverages.map((value) =>
      overallRevenueAverage > 0 ? clamp(value / overallRevenueAverage, 0.72, 1.28) : 1
    ),
    orders: orderAverages.map((value) =>
      overallOrderAverage > 0 ? clamp(value / overallOrderAverage, 0.72, 1.28) : 1
    ),
  };
}

function buildMonthlySeasonality(context) {
  const sales = analyticsService
    .getNormalizedSales(context)
    .filter((sale) => String(sale.status || "").trim() === "Paid");
  const revenueTotals = Array.from({ length: 12 }, () => 0);
  const orderTotals = Array.from({ length: 12 }, () => 0);
  const counts = Array.from({ length: 12 }, () => 0);

  sales.forEach((sale) => {
    const date = safeDate(sale.date || sale.createdAt);
    if (!date) return;

    const index = date.getMonth();
    revenueTotals[index] += toNumber(sale.total);
    orderTotals[index] += 1;
    counts[index] += 1;
  });

  const revenueAverages = revenueTotals.map((total, index) =>
    counts[index] > 0 ? total / counts[index] : 0
  );
  const orderAverages = orderTotals.map((total, index) =>
    counts[index] > 0 ? total / counts[index] : 0
  );
  const overallRevenueAverage = mean(revenueAverages.filter((value) => value > 0));
  const overallOrderAverage = mean(orderAverages.filter((value) => value > 0));

  return {
    revenue: revenueAverages.map((value) =>
      overallRevenueAverage > 0 ? clamp(value / overallRevenueAverage, 0.8, 1.2) : 1
    ),
    orders: orderAverages.map((value) =>
      overallOrderAverage > 0 ? clamp(value / overallOrderAverage, 0.8, 1.2) : 1
    ),
  };
}

function buildSeasonalityProfile(range, context) {
  if (range === "daily") {
    return {
      enabled: true,
      type: "weekday",
      ...buildDailySeasonality(context),
    };
  }

  if (range === "monthly") {
    return {
      enabled: true,
      type: "month-of-year",
      ...buildMonthlySeasonality(context),
    };
  }

  return {
    enabled: false,
    type: "none",
    revenue: [],
    orders: [],
  };
}

function resolveSeasonalityFactor(range, bucketStart, profile, channel = "revenue") {
  if (!profile?.enabled) {
    return 1;
  }

  const date = safeDate(bucketStart);
  if (!date) {
    return 1;
  }

  if (range === "daily") {
    return toNumber(profile?.[channel]?.[getWeekdayIndex(date)], 1);
  }

  if (range === "monthly") {
    return toNumber(profile?.[channel]?.[date.getMonth()], 1);
  }

  return 1;
}

function getForecastConfidence({
  historyPoints = 0,
  observedPoints = 0,
  holdoutWape = null,
  horizon = 1,
  leadSamples = 0,
  dataQualityPenalty = 0,
}) {
  const coverageScore =
    historyPoints > 0 ? clamp((observedPoints / historyPoints) * 30, 0, 30) : 0;
  const historyScore = clamp(historyPoints * 2.2, 0, 24);
  const errorScore =
    holdoutWape === null ? 10 : clamp(42 - toNumber(holdoutWape) * 0.55, 6, 42);
  const leadTimeScore = clamp(leadSamples * 2.4, 0, 10);
  const horizonPenalty = clamp((Math.max(1, horizon) - 1) * 1.2, 0, 14);

  return Math.round(
    clamp(
      18 + coverageScore + historyScore + errorScore + leadTimeScore - horizonPenalty - dataQualityPenalty,
      18,
      96
    )
  );
}

function buildConfidenceBreakdown({
  historyPoints = 0,
  observedPoints = 0,
  holdoutWape = null,
  horizon = 1,
  leadSamples = 0,
  dataQualityPenalty = 0,
}) {
  const coverageScore =
    historyPoints > 0 ? clamp((observedPoints / historyPoints) * 30, 0, 30) : 0;
  const historyScore = clamp(historyPoints * 2.2, 0, 24);
  const errorScore =
    holdoutWape === null ? 10 : clamp(42 - toNumber(holdoutWape) * 0.55, 6, 42);
  const leadTimeScore = clamp(leadSamples * 2.4, 0, 10);
  const horizonPenalty = clamp((Math.max(1, horizon) - 1) * 1.2, 0, 14);
  const total = getForecastConfidence({
    historyPoints,
    observedPoints,
    holdoutWape,
    horizon,
    leadSamples,
    dataQualityPenalty,
  });

  return {
    coverageScore: round(coverageScore, 1),
    historyScore: round(historyScore, 1),
    errorScore: round(errorScore, 1),
    leadTimeScore: round(leadTimeScore, 1),
    horizonPenalty: round(horizonPenalty, 1),
    dataQualityPenalty: round(dataQualityPenalty, 1),
    total,
  };
}

function backtestSeries(series = [], holdoutSize = 0) {
  if (series.length < 6 || holdoutSize < 2 || holdoutSize >= series.length) {
    return {
      holdoutPoints: 0,
      wape: null,
    };
  }

  const train = series.slice(0, -holdoutSize);
  const holdout = series.slice(-holdoutSize);
  const predicted = forecastHoltLinear(train, holdoutSize);

  return {
    holdoutPoints: holdout.length,
    wape: calculateWape(holdout, predicted),
  };
}

function getDefaultHorizon(range = "daily") {
  return DEFAULT_HORIZON_BY_RANGE[range] || DEFAULT_HORIZON_BY_RANGE.daily;
}

function clampHorizon(range = "daily", horizon = null) {
  const fallback = getDefaultHorizon(range);
  const maximum = MAX_HORIZON_BY_RANGE[range] || MAX_HORIZON_BY_RANGE.daily;
  const requested = Number.isInteger(Number(horizon)) ? Number(horizon) : fallback;
  return clamp(requested, 1, maximum);
}

function buildAggregatePeriods(range, horizon, context) {
  const trend = analyticsService.getSalesTrend(range, context);
  const revenueSeries = trend.map((item) => toNumber(item.revenue));
  const orderSeries = trend.map((item) => toNumber(item.orders));
  const lastBucketStart = startOfRange(context.latestObservedAt || new Date(), range);
  const seasonalityProfile = buildSeasonalityProfile(range, context);
  const revenueBacktest = backtestSeries(revenueSeries, Math.min(Math.max(2, Math.floor(revenueSeries.length / 3)), 4));
  const orderBacktest = backtestSeries(orderSeries, Math.min(Math.max(2, Math.floor(orderSeries.length / 3)), 4));
  const revenueModel = fitHoltLinear(revenueSeries);
  const orderModel = fitHoltLinear(orderSeries);
  const revenueForecast = forecastHoltLinear(revenueSeries, horizon);
  const orderForecast = forecastHoltLinear(orderSeries, horizon);
  const revenueResidualScale = getResidualScale(revenueSeries, revenueModel.fitted, 1);
  const orderResidualScale = getResidualScale(orderSeries, orderModel.fitted, 0.6);
  const confidenceBreakdown = buildConfidenceBreakdown({
    historyPoints: trend.length,
    observedPoints: trend.filter((item) => toNumber(item.revenue) > 0).length,
    holdoutWape:
      revenueBacktest.wape === null && orderBacktest.wape === null
        ? null
        : mean([revenueBacktest.wape ?? 0, orderBacktest.wape ?? 0]),
    horizon,
  });
  const confidenceScore = confidenceBreakdown.total;

  return {
    overview: {
      modelFamily: "operational-demand-intelligence",
      cadence: range,
      horizon,
      confidenceScore,
      confidenceBreakdown,
      revenueWape: revenueBacktest.wape,
      ordersWape: orderBacktest.wape,
      trainingPoints: trend.length,
      latestObservedLabel: trend[trend.length - 1]?.label || null,
      predictionInterval: "80%",
      seasonalityType: seasonalityProfile?.type || "none",
    },
    periods: revenueForecast.map((revenue, index) => {
      const bucketStart = addRangeStep(lastBucketStart, range, index + 1);
      const revenueSeasonality = resolveSeasonalityFactor(
        range,
        bucketStart,
        seasonalityProfile,
        "revenue"
      );
      const orderSeasonality = resolveSeasonalityFactor(
        range,
        bucketStart,
        seasonalityProfile,
        "orders"
      );
      const seasonallyAdjustedRevenue = revenue * revenueSeasonality;
      const projectedOrders = Math.max(
        0,
        Math.round((orderForecast[index] || 0) * orderSeasonality)
      );
      const revenueInterval = 1.28 * revenueResidualScale * Math.sqrt(index + 1);
      const ordersInterval = 1.28 * orderResidualScale * Math.sqrt(index + 1);
      const confidenceDecay = Math.max(18, confidenceScore - index * 4);

      return {
        label: formatBucketLabel(bucketStart, range),
        bucketStart: bucketStart.toISOString(),
        projectedRevenue: round(seasonallyAdjustedRevenue),
        projectedOrders,
        projectedAverageOrderValue:
          projectedOrders > 0 ? round(seasonallyAdjustedRevenue / projectedOrders) : 0,
        projectedRevenueLower: round(Math.max(0, seasonallyAdjustedRevenue - revenueInterval)),
        projectedRevenueUpper: round(seasonallyAdjustedRevenue + revenueInterval),
        projectedOrdersLower: Math.max(0, Math.round(projectedOrders - ordersInterval)),
        projectedOrdersUpper: Math.max(0, Math.round(projectedOrders + ordersInterval)),
        confidenceScore: confidenceDecay,
        seasonalityFactor: round((revenueSeasonality + orderSeasonality) / 2, 2),
      };
    }),
  };
}

function buildInboundByProduct(purchaseOrders = []) {
  const inbound = new Map();

  purchaseOrders
    .filter((order) => !["Received", "Cancelled"].includes(String(order.status || "").trim()))
    .forEach((order) => {
      (Array.isArray(order.items) ? order.items : []).forEach((item) => {
        const productId = Number(item.productId);
        if (!productId) return;
        const openUnits = Math.max(0, toNumber(item.qtyOrdered) - toNumber(item.qtyReceived));
        if (openUnits <= 0) return;
        inbound.set(productId, toNumber(inbound.get(productId)) + openUnits);
      });
    });

  return inbound;
}

function buildLeadTimeByProduct(purchaseOrders = []) {
  const leadSamples = new Map();

  purchaseOrders
    .filter((order) => String(order.status || "").trim() === "Received")
    .forEach((order) => {
      const sentAt = safeDate(order.sentAt || order.sentAtObj || order.createdAt);
      const receivedAt = safeDate(order.receivedAt || order.receivedAtObj || order.updatedAt);
      if (!sentAt || !receivedAt || receivedAt <= sentAt) return;

      const leadDays = Math.max(
        1,
        Math.round((receivedAt.getTime() - sentAt.getTime()) / (1000 * 60 * 60 * 24))
      );

      (Array.isArray(order.items) ? order.items : []).forEach((item) => {
        const productId = Number(item.productId);
        const receivedUnits = toNumber(item.qtyReceived);
        if (!productId || receivedUnits <= 0) return;

        if (!leadSamples.has(productId)) {
          leadSamples.set(productId, []);
        }

        leadSamples.get(productId).push(leadDays);
      });
    });

  const result = new Map();
  leadSamples.forEach((samples, productId) => {
    const average = round(mean(samples), 1);
    const p90 = round(Math.max(average, toNumber(percentile(samples, 0.9), average)), 1);
    result.set(productId, {
      mean: average,
      p90,
      samples: samples.length,
    });
  });

  return result;
}

function normalizeSupplierName(value) {
  const normalized = String(value || "").trim();
  return normalized || "General Supplier";
}

function buildSupplierExecutionBaseline(purchaseOrders = [], anchorDate = new Date()) {
  const baseline = new Map();

  const getEntry = (supplierName) => {
    const key = normalizeSupplierName(supplierName);
    if (!baseline.has(key)) {
      baseline.set(key, {
        supplier: key,
        orderCount: 0,
        receivedOrders: 0,
        openOrders: 0,
        lateOpenOrders: 0,
        lateReceipts: 0,
        onTimeReceipts: 0,
        unitsOrdered: 0,
        unitsReceived: 0,
        openUnits: 0,
        commitmentValue: 0,
        openCommitmentValue: 0,
        leadSamples: [],
      });
    }

    return baseline.get(key);
  };

  purchaseOrders.forEach((order) => {
    const entry = getEntry(order?.supplier);
    const items = Array.isArray(order?.items) ? order.items : [];
    const status = String(order?.status || "").trim().toLowerCase();
    const expectedAt = safeDate(order?.expectedDate || order?.expectedDateObj);
    const sentAt = safeDate(order?.sentAt || order?.sentAtObj || order?.createdAt);
    const receivedAt = safeDate(
      order?.receivedAt || order?.receivedAtObj || (status === "received" ? order?.updatedAt : null)
    );
    const orderedUnits = items.reduce(
      (sum, item) => sum + Math.max(0, toNumber(item?.qtyOrdered ?? item?.qty)),
      0
    );
    const receivedUnits = items.reduce((sum, item) => sum + Math.max(0, toNumber(item?.qtyReceived)), 0);
    const openUnits = Math.max(0, orderedUnits - receivedUnits);
    const commitmentValue = items.reduce(
      (sum, item) =>
        sum +
        Math.max(0, toNumber(item?.qtyOrdered ?? item?.qty)) *
          Math.max(0, toNumber(item?.unitCost ?? item?.cost ?? item?.price)),
      0
    );
    const openCommitmentValue = items.reduce((sum, item) => {
      const ordered = Math.max(0, toNumber(item?.qtyOrdered ?? item?.qty));
      const received = Math.max(0, toNumber(item?.qtyReceived));
      const unitCost = Math.max(0, toNumber(item?.unitCost ?? item?.cost ?? item?.price));
      return sum + Math.max(0, ordered - received) * unitCost;
    }, 0);
    const receivedOrder = status === "received" || (orderedUnits > 0 && receivedUnits >= orderedUnits);

    entry.orderCount += 1;
    entry.unitsOrdered += orderedUnits;
    entry.unitsReceived += receivedUnits;
    entry.openUnits += openUnits;
    entry.commitmentValue += commitmentValue;
    entry.openCommitmentValue += openCommitmentValue;

    if (receivedOrder) {
      entry.receivedOrders += 1;
      if (expectedAt && receivedAt) {
        if (receivedAt <= expectedAt) {
          entry.onTimeReceipts += 1;
        } else {
          entry.lateReceipts += 1;
        }
      }

      if (sentAt && receivedAt && receivedAt > sentAt) {
        entry.leadSamples.push(
          Math.max(1, (receivedAt.getTime() - sentAt.getTime()) / (1000 * 60 * 60 * 24))
        );
      }
      return;
    }

    if (openUnits > 0) {
      entry.openOrders += 1;
    }
    if (expectedAt && expectedAt < anchorDate) {
      entry.lateOpenOrders += 1;
    }
  });

  return new Map(
    [...baseline.entries()].map(([supplier, entry]) => {
      const fillRate =
        entry.unitsOrdered > 0 ? (entry.unitsReceived / entry.unitsOrdered) * 100 : null;
      const onTimeRate =
        entry.receivedOrders > 0 ? (entry.onTimeReceipts / entry.receivedOrders) * 100 : null;
      const averageLeadTimeDays = entry.leadSamples.length ? mean(entry.leadSamples) : null;
      const leadTimeVariabilityDays =
        entry.leadSamples.length > 1
          ? Math.sqrt(
              entry.leadSamples.reduce(
                (sum, value) => sum + (value - mean(entry.leadSamples)) ** 2,
                0
              ) / entry.leadSamples.length
            )
          : 0;
      const sortedLeadSamples = [...entry.leadSamples].sort((left, right) => left - right);
      const leadTimeP90Days =
        sortedLeadSamples.length > 0
          ? sortedLeadSamples[
              Math.min(
                sortedLeadSamples.length - 1,
                Math.floor((sortedLeadSamples.length - 1) * 0.9)
              )
            ]
          : null;
      const openPressure = clamp(entry.openUnits / Math.max(1, entry.unitsOrdered), 0, 1);
      const delayRiskScore = clamp(
        entry.lateOpenOrders * 17 +
          entry.lateReceipts * 11 +
          (fillRate === null ? (entry.openOrders > 0 ? 8 : 0) : Math.max(0, 90 - fillRate) * 0.55) +
          (onTimeRate === null ? 0 : Math.max(0, 92 - onTimeRate) * 0.4) +
          leadTimeVariabilityDays * 5.5 +
          openPressure * 18,
        0,
        100
      );
      const serviceScore = round(clamp(100 - delayRiskScore * 0.82, 2, 100), 0);

      return [
        supplier,
        {
          supplier: entry.supplier,
          orderCount: entry.orderCount,
          receivedOrders: entry.receivedOrders,
          openOrders: entry.openOrders,
          lateOpenOrders: entry.lateOpenOrders,
          lateReceipts: entry.lateReceipts,
          unitsOrdered: round(entry.unitsOrdered, 1),
          unitsReceived: round(entry.unitsReceived, 1),
          openUnits: round(entry.openUnits, 1),
          commitmentValue: round(entry.commitmentValue),
          openCommitmentValue: round(entry.openCommitmentValue),
          fillRate: fillRate === null ? null : round(fillRate, 1),
          onTimeRate: onTimeRate === null ? null : round(onTimeRate, 1),
          averageLeadTimeDays: averageLeadTimeDays === null ? null : round(averageLeadTimeDays, 1),
          leadTimeP90Days: leadTimeP90Days === null ? null : round(leadTimeP90Days, 1),
          leadTimeVariabilityDays: round(leadTimeVariabilityDays, 2),
          delayRiskScore: round(delayRiskScore, 1),
          serviceScore,
        },
      ];
    })
  );
}

function buildStockIntegrityByProduct(context = {}) {
  const signals = new Map();
  const trackedTypes = new Set([
    "sale",
    "sale_capture",
    "sale_refund",
    "sale_reversal",
    "purchase_receive",
    "restock",
  ]);

  const ensureSignal = (productId) => {
    const key = Number(productId);
    if (!key) return null;
    if (!signals.has(key)) {
      signals.set(key, {
        movementEvents: 0,
        negativeAdjustmentUnits: 0,
        nonSalesNegativeUnits: 0,
        cycleVarianceUnits: 0,
        cycleVarianceEvents: 0,
        integrityRisk: 0,
      });
    }
    return signals.get(key);
  };

  (Array.isArray(context.inventoryMovements) ? context.inventoryMovements : []).forEach((movement) => {
    const entry = ensureSignal(movement?.productId);
    if (!entry) return;

    const delta = toNumber(movement?.quantityDelta);
    const movementType = String(movement?.movementType || "").trim().toLowerCase();
    entry.movementEvents += 1;
    if (delta < 0) {
      entry.negativeAdjustmentUnits += Math.abs(delta);
      if (!trackedTypes.has(movementType)) {
        entry.nonSalesNegativeUnits += Math.abs(delta);
      }
    }
  });

  (Array.isArray(context.cycleCounts) ? context.cycleCounts : []).forEach((count) => {
    (Array.isArray(count?.items) ? count.items : []).forEach((item) => {
      const entry = ensureSignal(item?.productId);
      if (!entry) return;
      const varianceUnits = Math.abs(toNumber(item?.varianceQty));
      if (varianceUnits > 0) {
        entry.cycleVarianceUnits += varianceUnits;
        entry.cycleVarianceEvents += 1;
      }
    });
  });

  signals.forEach((value) => {
    const movementComponent = Math.min(
      1,
      value.nonSalesNegativeUnits / Math.max(4, value.negativeAdjustmentUnits + 1)
    );
    const cycleComponent = Math.min(
      1,
      value.cycleVarianceUnits / Math.max(4, value.cycleVarianceUnits + 4)
    );
    const eventComponent = Math.min(1, value.movementEvents * 0.05 + value.cycleVarianceEvents * 0.18);
    value.integrityRisk = round(
      clamp(movementComponent * 0.45 + cycleComponent * 0.35 + eventComponent * 0.2, 0, 1),
      4
    );
  });

  return signals;
}

function buildDailyDemandSeries(context, referenceDate) {
  const endDate = startOfDay(referenceDate);
  const startDate = addDays(endDate, -(HISTORY_DAYS - 1));
  const indexByDay = new Map();
  const seriesByProduct = new Map();
  const seriesByCategory = new Map();
  const lastSaleAtByProduct = new Map();
  const weekdayProfiles = new Map();
  const categoryWeekdayProfiles = new Map();
  const productCategory = new Map();
  const categoryCounts = new Map();
  const weekdayUnitsByProduct = new Map();
  const weekdayCountsByProduct = new Map();
  const weekdayUnitsByCategory = new Map();
  const weekdayCountsByCategory = new Map();

  for (let index = 0; index < HISTORY_DAYS; index += 1) {
    const day = addDays(startDate, index);
    const key = getDateKey(day);
    indexByDay.set(key, index);
  }

  context.products.forEach((product) => {
    const productId = Number(product.id);
    const category = String(product.category || "General").trim() || "General";
    seriesByProduct.set(productId, Array.from({ length: HISTORY_DAYS }, () => 0));
    productCategory.set(productId, category);
    categoryCounts.set(category, toNumber(categoryCounts.get(category)) + 1);

    if (!seriesByCategory.has(category)) {
      seriesByCategory.set(category, Array.from({ length: HISTORY_DAYS }, () => 0));
    }
  });

  analyticsService
    .getNormalizedSales(context)
    .filter((sale) => String(sale.status || "").trim() === "Paid")
    .forEach((sale) => {
      const saleDate = safeDate(sale.date || sale.createdAt);
      const dayKey = getDateKey(saleDate);
      const dayIndex = indexByDay.get(dayKey);

      if (dayIndex === undefined) {
        return;
      }

      sale.items.forEach((item) => {
        const productId = Number(item.id);
        const weekdayIndex = getWeekdayIndex(saleDate);
        const category = productCategory.get(productId) || String(item.category || "General").trim() || "General";
        if (!seriesByProduct.has(productId)) {
          seriesByProduct.set(productId, Array.from({ length: HISTORY_DAYS }, () => 0));
        }
        if (!seriesByCategory.has(category)) {
          seriesByCategory.set(category, Array.from({ length: HISTORY_DAYS }, () => 0));
        }
        if (!weekdayUnitsByProduct.has(productId)) {
          weekdayUnitsByProduct.set(productId, Array.from({ length: 7 }, () => 0));
          weekdayCountsByProduct.set(productId, Array.from({ length: 7 }, () => 0));
        }
        if (!weekdayUnitsByCategory.has(category)) {
          weekdayUnitsByCategory.set(category, Array.from({ length: 7 }, () => 0));
          weekdayCountsByCategory.set(category, Array.from({ length: 7 }, () => 0));
        }

        const series = seriesByProduct.get(productId);
        const categorySeries = seriesByCategory.get(category);
        const qty = toNumber(item.qty);
        series[dayIndex] += qty;
        categorySeries[dayIndex] += qty;
        weekdayUnitsByProduct.get(productId)[weekdayIndex] += qty;
        weekdayCountsByProduct.get(productId)[weekdayIndex] += 1;
        weekdayUnitsByCategory.get(category)[weekdayIndex] += qty;
        weekdayCountsByCategory.get(category)[weekdayIndex] += 1;

        if (!lastSaleAtByProduct.has(productId) || saleDate > lastSaleAtByProduct.get(productId)) {
          lastSaleAtByProduct.set(productId, saleDate);
        }
      });
    });

  weekdayUnitsByProduct.forEach((totals, productId) => {
    const counts = weekdayCountsByProduct.get(productId) || Array.from({ length: 7 }, () => 0);
    const averages = totals.map((total, index) => (counts[index] > 0 ? total / counts[index] : 0));
    const overall = mean(averages.filter((value) => value > 0));
    weekdayProfiles.set(
      productId,
      averages.map((value) => (overall > 0 ? clamp(value / overall, 0.65, 1.4) : 1))
    );
  });

  weekdayUnitsByCategory.forEach((totals, category) => {
    const counts = weekdayCountsByCategory.get(category) || Array.from({ length: 7 }, () => 0);
    const averages = totals.map((total, index) => (counts[index] > 0 ? total / counts[index] : 0));
    const overall = mean(averages.filter((value) => value > 0));
    categoryWeekdayProfiles.set(
      category,
      averages.map((value) => (overall > 0 ? clamp(value / overall, 0.7, 1.35) : 1))
    );
  });

  return {
    startDate,
    endDate,
    seriesByProduct,
    seriesByCategory,
    categoryCounts,
    productCategory,
    lastSaleAtByProduct,
    weekdayProfiles,
    categoryWeekdayProfiles,
  };
}

function getTrendDirection(recentAverage, previousAverage) {
  if (recentAverage <= 0 && previousAverage <= 0) return "flat";
  if (previousAverage <= 0 && recentAverage > 0) return "rising";

  const change = ((recentAverage - previousAverage) / Math.max(previousAverage, 0.01)) * 100;
  if (change >= 12) return "rising";
  if (change <= -12) return "falling";
  return "stable";
}

function getDemandPattern({ observedDays, totalUnits }) {
  const zeroRatio = 1 - observedDays / Math.max(1, HISTORY_DAYS);
  if (observedDays <= 0 || totalUnits <= 0) return "cold-start";
  if (zeroRatio >= INTERMITTENT_ZERO_RATIO) return "intermittent";
  if (observedDays < SPARSE_HISTORY_OBSERVED_DAYS || totalUnits < SPARSE_HISTORY_UNITS) return "sparse";
  return "stable";
}

function getCategoryFallbackBlend({ observedDays, totalUnits }) {
  if (observedDays >= SPARSE_HISTORY_OBSERVED_DAYS && totalUnits >= SPARSE_HISTORY_UNITS) {
    return 0;
  }

  const observedGap = Math.max(0, SPARSE_HISTORY_OBSERVED_DAYS - observedDays) / Math.max(1, SPARSE_HISTORY_OBSERVED_DAYS);
  const unitGap = Math.max(0, SPARSE_HISTORY_UNITS - totalUnits) / Math.max(1, SPARSE_HISTORY_UNITS);
  const gapScore = clamp(Math.max(observedGap, unitGap), 0, 1);

  return round(
    CATEGORY_FALLBACK_BASE_BLEND +
      gapScore * (CATEGORY_FALLBACK_MAX_BLEND - CATEGORY_FALLBACK_BASE_BLEND),
    4
  );
}

function buildDataQualityWarnings({ observedDays, leadTimeSamples, integrityRisk, categoryBlend }) {
  const warnings = [];
  if (observedDays < SPARSE_HISTORY_OBSERVED_DAYS) {
    warnings.push(`Only ${observedDays} selling day(s) were observed inside the training window.`);
  }
  if (leadTimeSamples <= 0) {
    warnings.push("Lead-time history is missing, so supplier timing relies on fallback averages.");
  }
  if (integrityRisk >= 0.35) {
    warnings.push("Inventory integrity noise is elevated because recent adjustments or count variances were detected.");
  }
  if (categoryBlend >= 0.25) {
    warnings.push("Category fallback is contributing materially because SKU history is sparse.");
  }
  return warnings.slice(0, 4);
}

function buildTopDrivers({
  stockoutProbability,
  trendDirection,
  supplierDelayRisk,
  integrityRisk,
  inboundUnits,
  categoryBlend,
  stockPolicyClass,
  cashPriorityTier,
}) {
  const drivers = [];
  if (stockoutProbability >= 0.6) {
    drivers.push("Projected stockout probability is above the safe operating band.");
  }
  if (trendDirection === "rising") {
    drivers.push("Recent demand trend is rising.");
  }
  if (inboundUnits <= 0) {
    drivers.push("No inbound replenishment is currently protecting this SKU.");
  }
  if (supplierDelayRisk >= 0.42) {
    drivers.push("Supplier execution risk is adding timing pressure.");
  }
  if (integrityRisk >= 0.3) {
    drivers.push("Inventory integrity noise is reducing confidence in on-hand stock.");
  }
  if (categoryBlend >= 0.25) {
    drivers.push("Category demand fallback is being used to stabilize sparse history.");
  }
  if (stockPolicyClass === "protect") {
    drivers.push("This SKU sits in the business protection tier and should not be left uncovered.");
  }
  if (cashPriorityTier === "defer") {
    drivers.push("Working capital should be deployed cautiously until sell-through improves.");
  }
  return drivers.slice(0, 4);
}

function getVelocityBand({ forecastDailyUnits, demandPattern, observedDays }) {
  if (demandPattern === "cold-start" || observedDays <= 0) return "unknown";
  if (demandPattern === "intermittent") return "intermittent";
  if (forecastDailyUnits >= 1.75) return "fast";
  if (forecastDailyUnits >= 0.75) return "steady";
  if (forecastDailyUnits >= 0.18) return "slow";
  return "minimal";
}

function buildStockPolicyClass({
  velocityBand,
  trendDirection,
  grossMarginPct,
  confidenceScore,
  demandPattern,
}) {
  if (
    velocityBand === "fast" ||
    ((trendDirection === "rising" || velocityBand === "steady") &&
      confidenceScore >= 48 &&
      grossMarginPct >= 14)
  ) {
    return "protect";
  }

  if (grossMarginPct >= 30 && velocityBand !== "minimal" && confidenceScore >= 42) {
    return "protect";
  }

  if (velocityBand === "steady" || trendDirection === "rising") {
    return "staple";
  }

  if (
    demandPattern === "intermittent" ||
    confidenceScore < 40 ||
    grossMarginPct < 12
  ) {
    return "cautious";
  }

  return "standard";
}

function getServiceLevelForPolicy(stockPolicyClass) {
  return SERVICE_LEVELS_BY_POLICY[stockPolicyClass] || SERVICE_LEVELS_BY_POLICY.standard;
}

function buildPolicyReason({
  stockPolicyClass,
  velocityBand,
  trendDirection,
  grossMarginPct,
  confidenceScore,
  demandPattern,
}) {
  if (stockPolicyClass === "protect") {
    return velocityBand === "fast"
      ? "Fast-moving revenue line with enough evidence to justify aggressive protection."
      : "Margin or trend quality is strong enough that this SKU deserves higher service protection.";
  }

  if (stockPolicyClass === "staple") {
    return "Steady demand makes this a core replenishment line, but not the most capital-intensive one.";
  }

  if (stockPolicyClass === "cautious") {
    if (demandPattern === "intermittent") {
      return "Demand is intermittent, so buying should stay disciplined until more consistent sell-through appears.";
    }
    if (grossMarginPct < 12) {
      return "Margin yield is thin, so capital should be allocated cautiously.";
    }
    if (confidenceScore < 40) {
      return "Model confidence is still thin, so this SKU should not be overprotected yet.";
    }
    return "This SKU should stay on a capital-disciplined policy until evidence improves.";
  }

  return "Balanced service policy with standard protection and standard reorder timing.";
}

function buildCashPriorityScore({
  riskLevel,
  stockoutProbability,
  grossMarginPct,
  forecastRevenue,
  supplierDelayRisk,
  confidenceScore,
  stockPolicyClass,
  demandPattern,
  orderSpend,
}) {
  const riskWeight =
    riskLevel === "critical" ? 22 : riskLevel === "high" ? 14 : riskLevel === "medium" ? 7 : 0;
  const revenueWeight = Math.min(24, Math.max(0, toNumber(forecastRevenue)) / 28);
  const marginWeight = Math.max(0, Math.min(20, (toNumber(grossMarginPct) - 8) * 0.55));
  const confidenceWeight = Math.max(0, Math.min(12, (toNumber(confidenceScore) - 35) * 0.24));
  const supplierWeight = clamp(toNumber(supplierDelayRisk), 0, 1) * 10;
  const policyBias =
    stockPolicyClass === "protect"
      ? 12
      : stockPolicyClass === "staple"
        ? 6
        : stockPolicyClass === "cautious"
          ? -12
          : 0;
  const intermittentPenalty = demandPattern === "intermittent" ? 7 : 0;
  const capitalReturn =
    orderSpend > 0 ? Math.min(12, Math.max(0, (toNumber(forecastRevenue) / Math.max(1, orderSpend)) * 3)) : 0;

  return round(
    clamp(
      toNumber(stockoutProbability) * 42 +
        riskWeight +
        revenueWeight +
        marginWeight +
        confidenceWeight +
        supplierWeight +
        policyBias +
        capitalReturn -
        intermittentPenalty,
      0,
      100
    ),
    1
  );
}

function getCashPriorityTier(score) {
  if (score >= 78) return "protect-now";
  if (score >= 60) return "invest-next";
  if (score >= 42) return "watch";
  return "defer";
}

function buildCashPriorityReason({ cashPriorityTier, orderSpend, stockPolicyClass, forecastRevenue }) {
  if (cashPriorityTier === "protect-now") {
    return `Protect this line first. The expected demand and risk justify roughly ${round(orderSpend)} in immediate inventory spend.`;
  }
  if (cashPriorityTier === "invest-next") {
    return `This line deserves near-term inventory capital, with about ${round(orderSpend)} in suggested spend supporting ${round(forecastRevenue)} in forecast revenue.`;
  }
  if (cashPriorityTier === "watch") {
    return "Keep this line funded but controlled while monitoring demand and supplier timing.";
  }
  if (stockPolicyClass === "cautious") {
    return "Defer aggressive spend here until sell-through or margin quality improves.";
  }
  return "No immediate capital move is required right now.";
}

function buildNextAction({ riskLevel, stockBuffer, stockoutProbability, stockPolicyClass, cashPriorityTier }) {
  if (cashPriorityTier === "protect-now") {
    return "Protect this SKU first and confirm inbound coverage today.";
  }
  if (cashPriorityTier === "invest-next" && stockPolicyClass === "protect") {
    return "Commit replenishment this cycle and keep this core line fully covered.";
  }
  if (riskLevel === "critical") {
    return "Reorder immediately and confirm inbound coverage today.";
  }
  if (riskLevel === "high") {
    return "Reorder within 48 hours and watch supplier commitments closely.";
  }
  if (riskLevel === "medium") {
    return "Keep this SKU on the reorder watchlist this week.";
  }
  if (stockBuffer > 0 && stockoutProbability < 0.15) {
    return "Safe to defer purchase and focus on faster-moving exposure.";
  }
  if (cashPriorityTier === "defer" || stockPolicyClass === "cautious") {
    return "Defer aggressive buying and use capital on stronger-protection lines first.";
  }
  return "Maintain current plan and continue monitoring demand.";
}

function buildRiskLevel({ stock, inboundUnits, forecastDailyUnits, recommendedOrderQty, daysCover, leadTimeDays }) {
  if (stock <= 0 && inboundUnits <= 0 && forecastDailyUnits > 0) {
    return "critical";
  }

  if (recommendedOrderQty > 0 && (daysCover === null || daysCover < leadTimeDays)) {
    return "high";
  }

  if (recommendedOrderQty > 0 || (daysCover !== null && daysCover <= leadTimeDays * 1.5)) {
    return "medium";
  }

  return "low";
}

function buildStockoutProbability(meanDemandDuringLead, demandDeviationDuringLead, availableUnits) {
  if (meanDemandDuringLead <= 0) {
    return 0;
  }
  if (demandDeviationDuringLead <= 0) {
    return availableUnits < meanDemandDuringLead ? 1 : 0;
  }

  const zScore = (availableUnits - meanDemandDuringLead) / demandDeviationDuringLead;
  return clamp(1 - normalCdf(zScore), 0, 1);
}

function buildRiskReason({ riskLevel, name, daysCover, leadTimeDays, inboundUnits, trendDirection }) {
  if (riskLevel === "critical") {
    return `${name} is already out of stock with no inbound cover on the current demand profile.`;
  }

  if (riskLevel === "high") {
    return `${name} is likely to fall short before the next replenishment window unless stock is raised now.`;
  }

  if (riskLevel === "medium") {
    return `${name} should be watched because projected cover is nearing the replenishment lead time.`;
  }

  if (daysCover !== null && daysCover > leadTimeDays * 2 && inboundUnits > 0) {
    return `${name} has enough cover and inbound stock to stay stable in the current planning window.`;
  }

  if (trendDirection === "rising") {
    return `${name} demand is rising, but current cover is still acceptable.`;
  }

  return `${name} is not showing immediate replenishment pressure.`;
}

function buildSkuForecasts(context, planningDays, limit) {
  const referenceDate = context.latestObservedAt || new Date();
  const inboundByProduct = buildInboundByProduct(context.purchaseOrders);
  const leadTimeByProduct = buildLeadTimeByProduct(context.purchaseOrders);
  const supplierExecutionBySupplier = buildSupplierExecutionBaseline(context.purchaseOrders, referenceDate);
  const stockIntegrityByProduct = buildStockIntegrityByProduct(context);
  const {
    seriesByProduct,
    seriesByCategory,
    categoryCounts,
    productCategory,
    lastSaleAtByProduct,
    weekdayProfiles,
    categoryWeekdayProfiles,
  } = buildDailyDemandSeries(context, referenceDate);
  const lowStockThreshold = Math.max(1, toNumber(context.settings?.lowStockThreshold, DEFAULT_LOW_STOCK_THRESHOLD));

  const productForecasts = context.products.map((product) => {
    const productId = Number(product.id);
    const category = productCategory.get(productId) || String(product.category || "General").trim() || "General";
    const demandSeries = seriesByProduct.get(productId) || Array.from({ length: HISTORY_DAYS }, () => 0);
    const categorySeriesTotal = seriesByCategory.get(category) || Array.from({ length: HISTORY_DAYS }, () => 0);
    const categoryCount = Math.max(1, toNumber(categoryCounts.get(category), 1));
    const categorySeries = categorySeriesTotal.map((value) => value / categoryCount);
    const nonZeroDays = demandSeries.filter((value) => value > 0).length;
    const totalUnitsObserved = demandSeries.reduce((sum, value) => sum + toNumber(value), 0);
    const recentWindow = demandSeries.slice(-14);
    const previousWindow = demandSeries.slice(-28, -14);
    const recentAverage = mean(recentWindow);
    const previousAverage = mean(previousWindow);
    const planningForecast = forecastHoltLinear(demandSeries, planningDays);
    const categoryForecast = forecastHoltLinear(categorySeries, planningDays);
    const fittedSeries = fitHoltLinear(demandSeries);
    const holdout = backtestSeries(demandSeries, Math.min(7, Math.max(2, Math.floor(HISTORY_DAYS / 6))));
    const demandPattern = getDemandPattern({ observedDays: nonZeroDays, totalUnits: totalUnitsObserved });
    const categoryBlend = getCategoryFallbackBlend({
      observedDays: nonZeroDays,
      totalUnits: totalUnitsObserved,
    });
    const residualScale = Math.max(0.35, getResidualScale(demandSeries, fittedSeries.fitted, 0.35));
    const weekdayProfile = weekdayProfiles.get(productId) || Array.from({ length: 7 }, () => 1);
    const categoryWeekdayProfile =
      categoryWeekdayProfiles.get(category) || Array.from({ length: 7 }, () => 1);
    const nonZeroValues = demandSeries.filter((value) => value > 0);
    const averageInterval = HISTORY_DAYS / Math.max(1, nonZeroDays);
    const intermittentDaily = nonZeroValues.length ? mean(nonZeroValues) / Math.max(1, averageInterval) : 0;
    const futureDailyUnits = [];
    const futureDailyLower = [];
    const futureDailyUpper = [];

    planningForecast.forEach((baseValue, index) => {
      const futureDate = addDays(startOfDay(referenceDate), index + 1);
      const weekdayIndex = getWeekdayIndex(futureDate);
      const selectedProfile = nonZeroDays >= 4 ? weekdayProfile : categoryWeekdayProfile;
      const seasonality = toNumber(selectedProfile[weekdayIndex], 1);
      let projected = Math.max(0, baseValue * seasonality);
      const categoryProjected = Math.max(
        0,
        toNumber(categoryForecast[index]) * toNumber(categoryWeekdayProfile[weekdayIndex], 1)
      );

      if (categoryBlend > 0) {
        projected = projected * (1 - categoryBlend) + categoryProjected * categoryBlend;
      }
      if (demandPattern === "intermittent") {
        projected = projected * (1 - INTERMITTENT_BLEND) + intermittentDaily * INTERMITTENT_BLEND;
      }

      const interval = 1.28 * residualScale * Math.sqrt(index + 1);
      futureDailyUnits.push(projected);
      futureDailyLower.push(Math.max(0, projected - interval));
      futureDailyUpper.push(projected + interval);
    });

    const baseForecastUnits = planningForecast.reduce((sum, value) => sum + Math.max(0, value), 0);
    const forecastUnits = futureDailyUnits.reduce((sum, value) => sum + Math.max(0, value), 0);
    const forecastLower = futureDailyLower.reduce((sum, value) => sum + value, 0);
    const forecastUpper = futureDailyUpper.reduce((sum, value) => sum + value, 0);
    const forecastDailyUnits = planningDays > 0 ? forecastUnits / planningDays : 0;
    const leadTime = leadTimeByProduct.get(productId) || {
      mean: DEFAULT_LEAD_TIME_DAYS,
      p90: DEFAULT_LEAD_TIME_DAYS,
      samples: 0,
    };
    const leadTimeDays = Math.max(1, toNumber(leadTime.mean, DEFAULT_LEAD_TIME_DAYS));
    const leadTimeP90Days = Math.max(leadTimeDays, toNumber(leadTime.p90, DEFAULT_LEAD_TIME_DAYS));
    const leadTimeSamples = Math.max(0, Math.round(toNumber(leadTime.samples, 0)));
    const inboundUnits = toNumber(inboundByProduct.get(productId));
    const stock = Math.max(0, toNumber(product.stock));
    const integrity = stockIntegrityByProduct.get(productId) || {
      movementEvents: 0,
      negativeAdjustmentUnits: 0,
      cycleVarianceUnits: 0,
      cycleVarianceEvents: 0,
      integrityRisk: 0,
    };
    const supplierExecution =
      supplierExecutionBySupplier.get(normalizeSupplierName(product.supplier)) || {
        delayRiskScore: 0,
        serviceScore: 100,
        fillRate: null,
        onTimeRate: null,
        lateOpenOrders: 0,
        openOrders: 0,
      };
    const demandDeviation = standardDeviation(recentWindow.length ? recentWindow : demandSeries);
    const leadTimeStd = Math.max(0.6, (leadTimeP90Days - leadTimeDays) / 1.2816);
    const grossMarginPct =
      toNumber(product.price) > 0
        ? ((toNumber(product.price) - toNumber(product.unitCost)) / toNumber(product.price)) * 100
        : 0;
    const trendDirection = getTrendDirection(recentAverage, previousAverage);
    const supplierDelayRisk = clamp(toNumber(supplierExecution.delayRiskScore) / 100, 0, 1);
    const dataQualityPenalty =
      toNumber(integrity.integrityRisk) * CONFIDENCE_INTEGRITY_PENALTY +
      supplierDelayRisk * CONFIDENCE_SUPPLIER_PENALTY +
      categoryBlend * 8 +
      (leadTimeSamples <= 0 ? 3 : 0);
    const confidenceBreakdown = buildConfidenceBreakdown({
      historyPoints: HISTORY_DAYS,
      observedPoints: nonZeroDays,
      holdoutWape: holdout.wape,
      horizon: Math.min(14, planningDays),
      leadSamples: leadTimeSamples,
      dataQualityPenalty,
    });
    const adjustedConfidenceScore = confidenceBreakdown.total;
    const velocityBand = getVelocityBand({
      forecastDailyUnits,
      demandPattern,
      observedDays: nonZeroDays,
    });
    const stockPolicyClass = buildStockPolicyClass({
      velocityBand,
      trendDirection,
      grossMarginPct,
      confidenceScore: adjustedConfidenceScore,
      demandPattern,
    });
    const serviceLevel = getServiceLevelForPolicy(stockPolicyClass);
    const demandDuringLead = forecastDailyUnits * leadTimeDays;
    const demandDeviationDuringLead = Math.sqrt(
      Math.max(
        0.01,
        demandDeviation ** 2 * leadTimeDays + Math.max(forecastDailyUnits, 0.1) ** 2 * leadTimeStd ** 2
      )
    );
    const safetyStock =
      forecastDailyUnits > 0 ? toNumber(serviceLevel.z, SERVICE_LEVEL_Z) * demandDeviationDuringLead : 0;
    const reorderPoint = demandDuringLead + safetyStock;
    const availableUnits = stock + inboundUnits;
    const recommendedOrderQty = Math.max(0, Math.ceil(reorderPoint + forecastUnits - availableUnits));
    const daysCover = forecastDailyUnits > 0 ? stock / forecastDailyUnits : null;
    let stockoutProbability = buildStockoutProbability(
      demandDuringLead,
      demandDeviationDuringLead,
      availableUnits
    );
    stockoutProbability = clamp(
      stockoutProbability +
        toNumber(integrity.integrityRisk) * STOCKOUT_INTEGRITY_ADJUSTMENT +
        supplierDelayRisk * STOCKOUT_SUPPLIER_ADJUSTMENT,
      0,
      1
    );
    const stockBuffer = availableUnits - reorderPoint;
    const riskLevel = buildRiskLevel({
      stock,
      inboundUnits,
      forecastDailyUnits,
      recommendedOrderQty,
      daysCover,
      leadTimeDays: leadTimeP90Days,
    });
    const forecastRevenue = forecastUnits * toNumber(product.price);
    const forecastRevenueLower = forecastLower * toNumber(product.price);
    const forecastRevenueUpper = forecastUpper * toNumber(product.price);
    const lastSoldAt = lastSaleAtByProduct.get(productId)?.toISOString() || null;
    const orderSpend = recommendedOrderQty * toNumber(product.unitCost);
    const cashPriorityScore = buildCashPriorityScore({
      riskLevel,
      stockoutProbability,
      grossMarginPct,
      forecastRevenue,
      supplierDelayRisk,
      confidenceScore: adjustedConfidenceScore,
      stockPolicyClass,
      demandPattern,
      orderSpend,
    });
    const cashPriorityTier = getCashPriorityTier(cashPriorityScore);
    const policyReason = buildPolicyReason({
      stockPolicyClass,
      velocityBand,
      trendDirection,
      grossMarginPct,
      confidenceScore: adjustedConfidenceScore,
      demandPattern,
    });
    const cashPriorityReason = buildCashPriorityReason({
      cashPriorityTier,
      orderSpend,
      stockPolicyClass,
      forecastRevenue,
    });
    const topDrivers = buildTopDrivers({
      stockoutProbability,
      trendDirection,
      supplierDelayRisk,
      integrityRisk: toNumber(integrity.integrityRisk),
      inboundUnits,
      categoryBlend,
      stockPolicyClass,
      cashPriorityTier,
    });
    const dataQualityWarnings = buildDataQualityWarnings({
      observedDays: nonZeroDays,
      leadTimeSamples,
      integrityRisk: toNumber(integrity.integrityRisk),
      categoryBlend,
    });
    const reason = buildRiskReason({
      riskLevel,
      name: product.name,
      daysCover,
      leadTimeDays: leadTimeP90Days,
      inboundUnits,
      trendDirection,
    });
    const nextAction = buildNextAction({
      riskLevel,
      stockBuffer,
      stockoutProbability,
      stockPolicyClass,
      cashPriorityTier,
    });

    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      category,
      supplier: product.supplier,
      currentStock: stock,
      lowStockThreshold,
      inboundUnits,
      leadTimeDays: round(leadTimeDays, 1),
      leadTimeP90Days: round(leadTimeP90Days, 1),
      leadTimeSamples,
      historicalUnits: round(totalUnitsObserved, 0),
      observedSellingDays: nonZeroDays,
      forecastUnits: round(forecastUnits, 1),
      forecastUnitsLower: round(forecastLower, 1),
      forecastUnitsUpper: round(forecastUpper, 1),
      forecastDailyUnits: round(forecastDailyUnits, 2),
      forecastRevenue: round(forecastRevenue),
      forecastRevenueLower: round(forecastRevenueLower),
      forecastRevenueUpper: round(forecastRevenueUpper),
      confidenceScore: adjustedConfidenceScore,
      confidenceBreakdown,
      holdoutWape: holdout.wape,
      trendDirection,
      demandPattern,
      velocityBand,
      safetyStock: round(safetyStock, 1),
      serviceLevelTargetPct: toNumber(serviceLevel.targetPct),
      serviceLevelZ: round(toNumber(serviceLevel.z), 2),
      stockPolicyClass,
      policyReason,
      reorderPoint: round(reorderPoint, 1),
      recommendedOrderQty,
      orderSpend: round(orderSpend),
      daysCover: daysCover === null ? null : round(daysCover, 1),
      lastSoldAt,
      riskLevel,
      urgency:
        riskLevel === "critical"
          ? "immediate"
          : riskLevel === "high"
            ? "this_week"
            : riskLevel === "medium"
              ? "watch"
              : "stable",
      stockoutProbability: round(stockoutProbability, 4),
      cashPriorityScore,
      cashPriorityTier,
      cashPriorityReason,
      reason,
      topDrivers,
      nextAction,
      whyNow: topDrivers[0] || reason,
      dataQualityWarnings,
      unitPrice: round(toNumber(product.price)),
      unitCost: round(toNumber(product.unitCost)),
      grossMarginPct: round(grossMarginPct, 1),
      stockBuffer: round(stockBuffer, 1),
      movementEvents: Math.round(toNumber(integrity.movementEvents)),
      negativeAdjustmentUnits: round(toNumber(integrity.negativeAdjustmentUnits), 1),
      cycleVarianceUnits: round(toNumber(integrity.cycleVarianceUnits), 1),
      cycleVarianceEvents: Math.round(toNumber(integrity.cycleVarianceEvents)),
      stockIntegrityRisk: round(toNumber(integrity.integrityRisk), 4),
      supplierDelayRiskScore: round(toNumber(supplierExecution.delayRiskScore), 1),
      supplierServiceScore: round(toNumber(supplierExecution.serviceScore), 0),
      supplierFillRate:
        supplierExecution.fillRate === null ? null : round(toNumber(supplierExecution.fillRate), 1),
      supplierOnTimeRate:
        supplierExecution.onTimeRate === null ? null : round(toNumber(supplierExecution.onTimeRate), 1),
      supplierLateCommitments: Math.round(toNumber(supplierExecution.lateOpenOrders)),
      supplierOpenOrders: Math.round(toNumber(supplierExecution.openOrders)),
      forecastDecomposition: {
        baseForecastUnits: round(baseForecastUnits, 1),
        seasonalityLiftPct: round(
          ((forecastUnits - Math.max(0, baseForecastUnits)) / Math.max(1, Math.max(0, baseForecastUnits))) *
            100,
          1
        ),
        categoryFallbackBlend: round(categoryBlend, 4),
        supplierRiskAdjustment: round(supplierDelayRisk, 4),
        serviceLevelTargetPct: toNumber(serviceLevel.targetPct),
        finalForecastUnits: round(forecastUnits, 1),
      },
    };
  });

  return productForecasts
    .sort((left, right) => {
      const riskPriority = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };

      return (
        riskPriority[left.riskLevel] - riskPriority[right.riskLevel] ||
        toNumber(right.cashPriorityScore) - toNumber(left.cashPriorityScore) ||
        toNumber(right.stockoutProbability) - toNumber(left.stockoutProbability) ||
        right.recommendedOrderQty - left.recommendedOrderQty ||
        right.forecastRevenue - left.forecastRevenue ||
        right.confidenceScore - left.confidenceScore
      );
    })
    .slice(0, limit);
}

function summarizeSkuForecasts(skuForecasts = []) {
  return {
    criticalCount: skuForecasts.filter((item) => item.riskLevel === "critical").length,
    highRiskCount: skuForecasts.filter((item) => item.riskLevel === "high").length,
    projectedRevenue: round(
      skuForecasts.reduce((sum, item) => sum + toNumber(item.forecastRevenue), 0)
    ),
    recommendedOrderUnits: Math.round(
      skuForecasts.reduce((sum, item) => sum + toNumber(item.recommendedOrderQty), 0)
    ),
    averageConfidenceScore: Math.round(
      mean(skuForecasts.map((item) => toNumber(item.confidenceScore)))
    ),
  };
}

function getDemandForecast(options = {}, context = null) {
  const resolvedContext = context;
  if (!resolvedContext) {
    throw new Error("Demand forecast requires an analytics context.");
  }

  const range = String(options.range || "daily").trim().toLowerCase();
  const horizon = clampHorizon(range, options.horizon);
  const skuLimit = clamp(toNumber(options.limit, DEFAULT_SKU_LIMIT), 1, 12);
  const planningDays = clamp(getRangeStepDays(range) * horizon, 7, 42);
  const aggregate = buildAggregatePeriods(range, horizon, resolvedContext);
  const skuForecasts = buildSkuForecasts(resolvedContext, planningDays, skuLimit);
  const recommendations = skuForecasts.filter(
    (item) =>
      item.recommendedOrderQty > 0 || ["critical", "high", "medium"].includes(item.riskLevel)
  );

  return {
    generatedAt: new Date().toISOString(),
    modelFamily: "operational-demand-intelligence",
    method:
      "Operational demand intelligence using Holt smoothing, empirical seasonality, prediction intervals, lead-time-aware stockout probability, stock-integrity adjustments, and safety-stock replenishment planning on live Mongo-backed business data.",
    overview: {
      ...aggregate.overview,
      planningDays,
      skuSummary: summarizeSkuForecasts(skuForecasts),
    },
    periods: aggregate.periods,
    skuForecasts,
    restockRecommendations: recommendations.slice(0, skuLimit),
  };
}

module.exports = {
  getDemandForecast,
  getDefaultHorizon,
  clampHorizon,
};
