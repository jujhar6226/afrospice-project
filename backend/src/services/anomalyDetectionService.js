const analyticsService = require("./analyticsService");

const OBSERVATION_DAYS = 42;
const BASELINE_WINDOW = 7;
const MAX_ALERTS = 6;

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

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function getDateKey(date) {
  return startOfDay(date).toISOString().slice(0, 10);
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

function buildDailyMetrics(context) {
  const latestObservedAt = safeDate(context.latestObservedAt) || new Date();
  const startDate = addDays(startOfDay(latestObservedAt), -(OBSERVATION_DAYS - 1));
  const dayMap = new Map();

  for (let index = 0; index < OBSERVATION_DAYS; index += 1) {
    const day = addDays(startDate, index);
    const key = getDateKey(day);
    dayMap.set(key, {
      date: key,
      label: day.toLocaleDateString("en-CA", { month: "short", day: "numeric" }),
      revenue: 0,
      totalOrders: 0,
      paidOrders: 0,
      refundedOrders: 0,
      declinedOrders: 0,
      pendingOrders: 0,
    });
  }

  context.sales.forEach((sale) => {
    const saleDate = safeDate(sale.date || sale.createdAt);
    if (!saleDate) return;

    const entry = dayMap.get(getDateKey(saleDate));
    if (!entry) return;

    entry.totalOrders += 1;

    if (String(sale.status || "").trim() === "Paid") {
      entry.paidOrders += 1;
      entry.revenue += toNumber(sale.total);
    } else if (String(sale.status || "").trim() === "Refunded") {
      entry.refundedOrders += 1;
    } else if (String(sale.status || "").trim() === "Declined") {
      entry.declinedOrders += 1;
    } else if (String(sale.status || "").trim() === "Pending") {
      entry.pendingOrders += 1;
    }
  });

  return [...dayMap.values()].map((entry) => ({
    ...entry,
    paidRate: entry.totalOrders > 0 ? round((entry.paidOrders / entry.totalOrders) * 100, 1) : 0,
    refundRate:
      entry.totalOrders > 0 ? round((entry.refundedOrders / entry.totalOrders) * 100, 1) : 0,
    declineRate:
      entry.totalOrders > 0 ? round((entry.declinedOrders / entry.totalOrders) * 100, 1) : 0,
  }));
}

function buildAlertTone(metric, delta, zScore) {
  const negativeShift = delta < 0;

  if (metric === "refundRate" || metric === "declineRate") {
    return zScore >= 2.2 ? "danger" : "warning";
  }

  if ((metric === "revenue" || metric === "orders") && negativeShift) {
    return zScore >= 2.4 ? "danger" : "warning";
  }

  if (metric === "paidRate" && negativeShift) {
    return zScore >= 2.4 ? "danger" : "warning";
  }

  return "success";
}

function buildAlertHeadline(metric, tone, label) {
  if (metric === "revenue") {
    return tone === "success"
      ? `Revenue jumped on ${label}`
      : `Revenue broke below baseline on ${label}`;
  }

  if (metric === "orders") {
    return tone === "success"
      ? `Order volume spiked on ${label}`
      : `Order flow softened on ${label}`;
  }

  if (metric === "refundRate") {
    return `Refund rate spiked on ${label}`;
  }

  if (metric === "declineRate") {
    return `Decline rate rose on ${label}`;
  }

  return `Paid conversion shifted on ${label}`;
}

function describeMetric(metric, observed, baseline) {
  if (metric === "revenue") {
    return `Observed paid revenue was ${round(observed)} against a rolling baseline of ${round(
      baseline
    )}.`;
  }

  if (metric === "orders") {
    return `Observed orders were ${Math.round(observed)} against a rolling baseline of ${round(
      baseline,
      1
    )}.`;
  }

  return `Observed ${metric} was ${round(observed, 1)}% against a rolling baseline of ${round(
    baseline,
    1
  )}%.`;
}

function detectMetricAlerts(series, metric, config = {}) {
  const alerts = [];
  const threshold = toNumber(config.zThreshold, 2.2);
  const minAbsoluteDelta = toNumber(config.minAbsoluteDelta, 0);
  const minBaseline = toNumber(config.minBaseline, 0);

  for (let index = BASELINE_WINDOW; index < series.length; index += 1) {
    const current = series[index];
    const baselineSlice = series.slice(Math.max(0, index - BASELINE_WINDOW), index);
    const baselineValues = baselineSlice.map((item) => toNumber(item[metric]));
    const baselineAverage = mean(baselineValues);
    const deviation = standardDeviation(baselineValues);
    const observed = toNumber(current[metric]);
    const absoluteDelta = observed - baselineAverage;

    if (Math.abs(absoluteDelta) < minAbsoluteDelta) {
      continue;
    }

    if (baselineAverage < minBaseline && observed < minBaseline) {
      continue;
    }

    const zScore =
      deviation > 0 ? Math.abs((observed - baselineAverage) / deviation) : observed > baselineAverage ? 3 : 0;

    if (zScore < threshold) {
      continue;
    }

    const deltaPercent =
      baselineAverage > 0
        ? ((observed - baselineAverage) / baselineAverage) * 100
        : observed > 0
          ? 100
          : 0;
    const tone = buildAlertTone(metric, deltaPercent, zScore);

    alerts.push({
      metric,
      date: current.date,
      label: current.label,
      tone,
      headline: buildAlertHeadline(metric, tone, current.label),
      summary: describeMetric(metric, observed, baselineAverage),
      observedValue: round(observed, metric === "orders" ? 0 : 1),
      baselineValue: round(baselineAverage, metric === "orders" ? 0 : 1),
      deviationPercent: round(deltaPercent, 1),
      zScore: round(zScore, 2),
      focus:
        metric === "revenue" || metric === "orders"
          ? "reports-ml-forecast"
          : "dashboard-cash-pulse",
      severityScore: round(
        clamp(zScore * 22 + Math.abs(deltaPercent) * 0.35 + (tone === "danger" ? 12 : 0), 0, 100),
        1
      ),
    });
  }

  return alerts;
}

function summarizeAlerts(alerts = []) {
  const dangerCount = alerts.filter((item) => item.tone === "danger").length;
  const warningCount = alerts.filter((item) => item.tone === "warning").length;
  const successCount = alerts.filter((item) => item.tone === "success").length;
  const topAlert = alerts[0] || null;

  return {
    totalAlerts: alerts.length,
    dangerCount,
    warningCount,
    successCount,
    topAlert,
    statusTone: dangerCount > 0 ? "danger" : warningCount > 0 ? "warning" : "success",
  };
}

function getOperationalAnomalyAlerts(context) {
  const series = buildDailyMetrics(context);
  const alerts = [
    ...detectMetricAlerts(series, "revenue", { zThreshold: 2.1, minAbsoluteDelta: 40, minBaseline: 25 }),
    ...detectMetricAlerts(series, "orders", { zThreshold: 2.1, minAbsoluteDelta: 2, minBaseline: 1 }),
    ...detectMetricAlerts(series, "refundRate", { zThreshold: 2.0, minAbsoluteDelta: 6, minBaseline: 1 }),
    ...detectMetricAlerts(series, "declineRate", { zThreshold: 2.0, minAbsoluteDelta: 6, minBaseline: 1 }),
    ...detectMetricAlerts(series, "paidRate", { zThreshold: 2.2, minAbsoluteDelta: 8, minBaseline: 20 }),
  ]
    .sort((left, right) => right.severityScore - left.severityScore)
    .slice(0, MAX_ALERTS);

  return {
    generatedAt: new Date().toISOString(),
    observationDays: OBSERVATION_DAYS,
    baselineWindowDays: BASELINE_WINDOW,
    summary: summarizeAlerts(alerts),
    alerts,
    recentDailySeries: series.slice(-14),
  };
}

module.exports = {
  getOperationalAnomalyAlerts,
};
