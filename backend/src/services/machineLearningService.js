const anomalyDetectionService = require("./anomalyDetectionService");
const forecastingService = require("./forecastingService");
const pythonMlService = require("./pythonMlService");

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, toNumber(value)));
}

function mean(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + toNumber(value), 0) / values.length;
}

function normalizeSupplierName(value) {
  const normalized = String(value || "").trim();
  return normalized || "General Supplier";
}

function getModelItemKey(item = {}, index = 0) {
  if (item?.id !== undefined && item?.id !== null && String(item.id).trim()) {
    return `id:${String(item.id).trim()}`;
  }
  if (item?.sku && String(item.sku).trim()) {
    return `sku:${String(item.sku).trim()}`;
  }
  if (item?.supplier && String(item.supplier).trim()) {
    return `supplier:${String(item.supplier).trim()}`;
  }
  if (item?.name && String(item.name).trim()) {
    return `name:${String(item.name).trim()}`;
  }
  return `index:${index}`;
}

function mergeModelCollections(fallbackItems = [], preferredItems = []) {
  if (!Array.isArray(preferredItems)) {
    return Array.isArray(fallbackItems) ? fallbackItems : [];
  }

  const fallbackByKey = new Map(
    (Array.isArray(fallbackItems) ? fallbackItems : []).map((item, index) => [
      getModelItemKey(item, index),
      item,
    ])
  );

  return preferredItems.map((item, index) => {
    const fallback = fallbackByKey.get(getModelItemKey(item, index)) || {};
    return {
      ...fallback,
      ...item,
    };
  });
}

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildStockoutRisks(forecast) {
  const risks = Array.isArray(forecast?.restockRecommendations)
    ? forecast.restockRecommendations
    : [];

  return risks
    .filter((item) => ["critical", "high", "medium"].includes(String(item.riskLevel || "").toLowerCase()))
    .map((item) => ({
      id: item.id,
      name: item.name,
      sku: item.sku,
      supplier: item.supplier,
      riskLevel: item.riskLevel,
      stockPolicyClass: item.stockPolicyClass || "standard",
      serviceLevelTargetPct: toNumber(item.serviceLevelTargetPct),
      cashPriorityScore: toNumber(item.cashPriorityScore),
      cashPriorityTier: item.cashPriorityTier || "watch",
      cashPriorityReason: item.cashPriorityReason || null,
      currentStock: toNumber(item.currentStock),
      inboundUnits: toNumber(item.inboundUnits),
      forecastRevenue: toNumber(item.forecastRevenue),
      projectedStockoutDays:
        item.daysCover === null || item.daysCover === undefined ? null : toNumber(item.daysCover),
      recommendedOrderQty: toNumber(item.recommendedOrderQty),
      orderSpend: toNumber(item.orderSpend),
      confidenceScore: toNumber(item.confidenceScore),
      stockoutProbability: toNumber(item.stockoutProbability),
      reason: item.reason,
      topDrivers: Array.isArray(item.topDrivers) ? item.topDrivers : [],
      nextAction: item.nextAction || null,
    }))
    .slice(0, 6);
}

function buildPromotionCandidates(forecast) {
  const skuForecasts = Array.isArray(forecast?.skuForecasts) ? forecast.skuForecasts : [];

  return skuForecasts
    .map((item) => {
      const unitPrice = toNumber(item.unitPrice);
      const unitCost = toNumber(item.unitCost);
      const grossMarginPct = unitPrice > 0 ? ((unitPrice - unitCost) / unitPrice) * 100 : 0;
      const stockBuffer =
        toNumber(item.currentStock) + toNumber(item.inboundUnits) - toNumber(item.reorderPoint);
      const opportunityScore =
        Math.max(0, toNumber(item.confidenceScore) - 40) * 0.6 +
        Math.max(0, grossMarginPct - 15) * 0.4 +
        Math.max(0, stockBuffer) * 0.2 +
        (String(item.trendDirection || "") === "rising" ? 12 : 0) +
        (String(item.riskLevel || "") === "low" ? 8 : 0);

      return {
        id: item.id,
        name: item.name,
        sku: item.sku,
        category: item.category,
        supplier: item.supplier,
        stockPolicyClass: item.stockPolicyClass || "standard",
        trendDirection: item.trendDirection,
        currentStock: toNumber(item.currentStock),
        reorderPoint: toNumber(item.reorderPoint),
        stockBuffer: round(stockBuffer, 1),
        forecastRevenue: toNumber(item.forecastRevenue),
        confidenceScore: toNumber(item.confidenceScore),
        grossMarginPct: round(grossMarginPct, 1),
        stockoutProbability: toNumber(item.stockoutProbability),
        opportunityScore: round(opportunityScore, 1),
        nextAction: item.nextAction || "Promote carefully while stock buffer remains healthy.",
      };
    })
    .filter(
      (item) =>
        item.stockPolicyClass !== "protect" &&
        item.confidenceScore >= 45 &&
        item.stockBuffer > 0 &&
        item.grossMarginPct >= 18 &&
        ["rising", "stable"].includes(String(item.trendDirection || "").toLowerCase())
    )
    .sort(
      (left, right) =>
        right.opportunityScore - left.opportunityScore ||
        right.forecastRevenue - left.forecastRevenue
    )
    .slice(0, 6);
}

function buildSupplierExecutionBaseline(context = {}) {
  const anchorDate = context.latestObservedAt instanceof Date ? context.latestObservedAt : new Date();
  const purchaseOrders = Array.isArray(context.purchaseOrders) ? context.purchaseOrders : [];
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
    const status = String(order?.status || "").trim();
    const expectedAt = safeDate(order?.expectedDate || order?.expectedDateObj);
    const sentAt = safeDate(order?.sentAt || order?.sentAtObj || order?.createdAt);
    const receivedAt = safeDate(order?.receivedAt || order?.receivedAtObj || (status === "Received" ? order?.updatedAt : null));
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
    const receivedOrder = status === "Received" || (orderedUnits > 0 && receivedUnits >= orderedUnits);

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

  return [...baseline.values()].map((entry) => {
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
        ? sortedLeadSamples[Math.min(sortedLeadSamples.length - 1, Math.floor((sortedLeadSamples.length - 1) * 0.9))]
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

    return {
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
    };
  });
}

function buildSupplierSignals(forecast, context = {}) {
  const baseline = buildSupplierExecutionBaseline(context);
  const baselineBySupplier = new Map(
    baseline.map((entry) => [normalizeSupplierName(entry.supplier), entry])
  );
  const skuForecasts = Array.isArray(forecast?.skuForecasts) ? forecast.skuForecasts : [];
  const supplierNames = new Set([
    ...baseline.map((entry) => normalizeSupplierName(entry.supplier)),
    ...skuForecasts.map((item) => normalizeSupplierName(item?.supplier)),
  ]);

  return [...supplierNames]
    .map((supplier) => {
      const entry =
        baselineBySupplier.get(supplier) || {
          supplier,
          orderCount: 0,
          receivedOrders: 0,
          openOrders: 0,
          lateOpenOrders: 0,
          lateReceipts: 0,
          unitsOrdered: 0,
          unitsReceived: 0,
          openUnits: 0,
          commitmentValue: 0,
          openCommitmentValue: 0,
          fillRate: null,
          onTimeRate: null,
          averageLeadTimeDays: null,
          leadTimeP90Days: null,
          leadTimeVariabilityDays: 0,
          delayRiskScore: 0,
          serviceScore: 100,
        };
      const exposedSkus = skuForecasts.filter(
        (item) =>
          normalizeSupplierName(item?.supplier) === supplier &&
          ["critical", "high", "medium"].includes(String(item?.riskLevel || "").toLowerCase())
      );
      const maxStockoutProbability = Math.max(
        0,
        ...exposedSkus.map((item) => toNumber(item?.stockoutProbability))
      );
      const exposedForecastRevenue = exposedSkus.reduce(
        (sum, item) => sum + toNumber(item?.forecastRevenue),
        0
      );
      const weightedRiskScore = round(
        clamp(
          toNumber(entry.delayRiskScore) +
            exposedSkus.length * 8 +
            maxStockoutProbability * 28 +
            clamp(toNumber(entry.openUnits) / Math.max(1, toNumber(entry.unitsOrdered)), 0, 1) * 14,
          0,
          100
        ),
        1
      );
      const statusTone =
        weightedRiskScore >= 72 ? "danger" : weightedRiskScore >= 42 ? "warning" : "success";

      return {
        supplier,
        weightedRiskScore,
        statusTone,
        serviceScore: round(entry.serviceScore, 0),
        delayRiskScore: round(entry.delayRiskScore, 1),
        orderCount: toNumber(entry.orderCount),
        receivedOrders: toNumber(entry.receivedOrders),
        openOrders: toNumber(entry.openOrders),
        lateOpenOrders: toNumber(entry.lateOpenOrders),
        lateReceipts: toNumber(entry.lateReceipts),
        fillRate: entry.fillRate === null ? null : round(entry.fillRate, 1),
        onTimeRate: entry.onTimeRate === null ? null : round(entry.onTimeRate, 1),
        averageLeadTimeDays:
          entry.averageLeadTimeDays === null ? null : round(entry.averageLeadTimeDays, 1),
        leadTimeP90Days: entry.leadTimeP90Days === null ? null : round(entry.leadTimeP90Days, 1),
        leadTimeVariabilityDays: round(entry.leadTimeVariabilityDays, 2),
        openCommitmentValue: round(entry.openCommitmentValue),
        openUnits: round(entry.openUnits, 1),
        exposedSkuCount: exposedSkus.length,
        maxStockoutProbability: round(maxStockoutProbability, 4),
        exposedForecastRevenue: round(exposedForecastRevenue),
        nextAction:
          weightedRiskScore >= 72
            ? `Escalate ${supplier}, chase open commitments, and protect exposed SKUs now.`
            : weightedRiskScore >= 42
              ? `Watch ${supplier} closely and tighten reorder timing around its exposed SKUs.`
              : `${supplier} is currently stable enough for the visible replenishment plan.`,
      };
    })
    .sort(
      (left, right) =>
        right.weightedRiskScore - left.weightedRiskScore ||
        right.openCommitmentValue - left.openCommitmentValue ||
        right.maxStockoutProbability - left.maxStockoutProbability
    )
    .slice(0, 6);
}

function buildModelSummary(
  forecast,
  anomalies,
  stockoutRisks,
  promotionCandidates,
  dataFoundation = {},
  supplierSignals = []
) {
  const overview = forecast?.overview || {};
  const topStockoutRisk = stockoutRisks[0] || null;
  const topPromotionCandidate = promotionCandidates[0] || null;
  const topSupplierRisk = supplierSignals[0] || null;
  const topCapitalPriority =
    (forecast?.skuForecasts || [])
      .slice()
      .sort(
        (left, right) =>
          toNumber(right.cashPriorityScore) - toNumber(left.cashPriorityScore) ||
          toNumber(right.stockoutProbability) - toNumber(left.stockoutProbability)
      )[0] || null;

  return {
    confidenceScore: toNumber(overview.confidenceScore),
    averageSkuConfidence: Math.round(
      mean((forecast?.skuForecasts || []).map((item) => toNumber(item.confidenceScore)))
    ),
    revenueWape: overview.revenueWape === null ? null : toNumber(overview.revenueWape),
    ordersWape: overview.ordersWape === null ? null : toNumber(overview.ordersWape),
    anomalyTone: anomalies?.summary?.statusTone || "success",
    anomalyCount: toNumber(anomalies?.summary?.totalAlerts),
    stockoutRiskCount: stockoutRisks.length,
    promotionOpportunityCount: promotionCandidates.length,
    supplierRiskCount: supplierSignals.filter((item) => item.statusTone !== "success").length,
    dataRichnessScore: toNumber(dataFoundation.richnessScore),
    topStockoutRisk,
    topPromotionCandidate,
    topSupplierRisk,
    topCapitalPriority,
  };
}

function buildDataFoundation(context = {}) {
  const sales = Array.isArray(context.sales) ? context.sales : [];
  const paidSales = sales.filter((sale) => String(sale.status || "").trim() === "Paid");
  const saleItems = paidSales.flatMap((sale) => (Array.isArray(sale.items) ? sale.items : []));
  const products = Array.isArray(context.products) ? context.products : [];
  const purchaseOrders = Array.isArray(context.purchaseOrders) ? context.purchaseOrders : [];
  const inventoryMovements = Array.isArray(context.inventoryMovements)
    ? context.inventoryMovements
    : [];
  const cycleCounts = Array.isArray(context.cycleCounts) ? context.cycleCounts : [];
  const customers = Array.isArray(context.customers) ? context.customers : [];
  const suppliers = Array.isArray(context.suppliers) ? context.suppliers : [];
  const users = Array.isArray(context.users) ? context.users : [];

  const namedCustomerSales = paidSales.filter((sale) => {
    const value = String(sale.customer || "").trim().toLowerCase();
    return value && !["walk-in", "walk-in customer", "walk in", "guest", "anonymous"].includes(value);
  });
  const movementProductCount = new Set(
    inventoryMovements
      .map((movement) => movement.productId)
      .filter((productId) => productId !== null && productId !== undefined)
  ).size;
  const cycleCountProductCount = new Set(
    cycleCounts.flatMap((count) =>
      (Array.isArray(count.items) ? count.items : [])
        .map((item) => item.productId)
        .filter((productId) => productId !== null && productId !== undefined)
    )
  ).size;

  const earliestDates = [
    ...sales.map((sale) => new Date(sale.date || sale.createdAt)),
    ...inventoryMovements.map((movement) => new Date(movement.createdAt)),
    ...purchaseOrders.map((order) => new Date(order.createdAt)),
  ]
    .filter((date) => !Number.isNaN(date.getTime()));
  const earliest = earliestDates.length
    ? new Date(Math.min(...earliestDates.map((date) => date.getTime())))
    : null;
  const latest = context.latestObservedAt instanceof Date ? context.latestObservedAt : new Date();
  const historyDays =
    earliest && !Number.isNaN(latest.getTime())
      ? Math.max(1, Math.round((latest.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24)) + 1)
      : 1;

  const paidSalesRate = sales.length ? (paidSales.length / sales.length) * 100 : 0;
  const namedCustomerRate = paidSales.length ? (namedCustomerSales.length / paidSales.length) * 100 : 0;
  const movementCoverageRate = products.length ? (movementProductCount / products.length) * 100 : 0;
  const cycleCountCoverageRate = products.length ? (cycleCountProductCount / products.length) * 100 : 0;
  const leadTimeProductCoverage = new Set(
    purchaseOrders
      .filter((order) => String(order.status || "").trim() === "Received")
      .flatMap((order) => (Array.isArray(order.items) ? order.items : []))
      .map((item) => item.productId)
      .filter((productId) => productId !== null && productId !== undefined)
  ).size;
  const leadTimeCoverageRate = products.length ? (leadTimeProductCoverage / products.length) * 100 : 0;

  const richnessScore = Math.round(
    clamp(
      (Math.min(1, historyDays / 180) * 28) +
        (Math.min(1, sales.length / 250) * 18) +
        (Math.min(1, saleItems.length / 800) * 16) +
        (Math.min(1, movementCoverageRate / 100) * 14) +
        (Math.min(1, leadTimeCoverageRate / 100) * 10) +
        (Math.min(1, cycleCountCoverageRate / 100) * 8) +
        (Math.min(1, namedCustomerRate / 100) * 6),
      12,
      100
    )
  );

  const qualityWarnings = [];
  if (historyDays < 90) {
    qualityWarnings.push(`Only ${historyDays} day(s) of operating history are available to the model.`);
  }
  if (leadTimeCoverageRate < 40) {
    qualityWarnings.push("Lead-time coverage is still thin across the product catalog.");
  }
  if (cycleCountCoverageRate < 20) {
    qualityWarnings.push("Cycle-count coverage is low, so stock integrity confidence is limited.");
  }
  if (namedCustomerRate < 35) {
    qualityWarnings.push("Named-customer coverage is limited, which reduces relationship-level demand context.");
  }

  return {
    richnessScore,
    narrative:
      richnessScore >= 72
        ? "The model foundation is broad enough to support stronger demand, lead-time, and stock-risk signals."
        : richnessScore >= 48
          ? "The model foundation is usable, but it still needs more history depth and operational coverage to tighten confidence."
          : "The model foundation is still thin, so forecast intervals and confidence should be treated cautiously.",
    historyDays,
    qualityWarnings,
    entityCounts: {
      products: products.length,
      sales: sales.length,
      paidSales: paidSales.length,
      saleItems: saleItems.length,
      purchaseOrders: purchaseOrders.length,
      inventoryMovements: inventoryMovements.length,
      cycleCounts: cycleCounts.length,
      customers: customers.length,
      suppliers: suppliers.length,
      users: users.length,
    },
    coverage: {
      paidSalesRate: round(paidSalesRate, 1),
      namedCustomerRate: round(namedCustomerRate, 1),
      movementCoverageRate: round(movementCoverageRate, 1),
      cycleCountCoverageRate: round(cycleCountCoverageRate, 1),
      leadTimeCoverageRate: round(leadTimeCoverageRate, 1),
    },
  };
}

function buildPortfolioSummary(forecast, stockoutRisks = [], promotionCandidates = [], supplierSignals = []) {
  const skuForecasts = Array.isArray(forecast?.skuForecasts) ? forecast.skuForecasts : [];
  const exposedRevenue = stockoutRisks.reduce(
    (sum, item) => sum + toNumber(item.forecastRevenue || item.exposedForecastRevenue || 0),
    0
  );
  const recommendedOrderUnits = skuForecasts.reduce(
    (sum, item) => sum + toNumber(item.recommendedOrderQty),
    0
  );
  const recommendedOrderSpend = skuForecasts.reduce(
    (sum, item) => sum + toNumber(item.recommendedOrderQty) * toNumber(item.unitCost),
    0
  );
  const highPriorityOrderSpend = skuForecasts
    .filter((item) => ["protect-now", "invest-next"].includes(String(item.cashPriorityTier || "")))
    .reduce((sum, item) => sum + toNumber(item.orderSpend), 0);
  const protectedRevenue = skuForecasts
    .filter((item) => String(item.stockPolicyClass || "") === "protect")
    .reduce((sum, item) => sum + toNumber(item.forecastRevenue), 0);
  const deferredSkuCount = skuForecasts.filter(
    (item) => String(item.cashPriorityTier || "") === "defer"
  ).length;
  const promotionRevenuePool = promotionCandidates.reduce(
    (sum, item) => sum + toNumber(item.forecastRevenue),
    0
  );
  const promotionMarginPool = promotionCandidates.reduce(
    (sum, item) => sum + toNumber(item.forecastRevenue) * (toNumber(item.grossMarginPct) / 100),
    0
  );

  return {
    exposedRevenue: round(exposedRevenue),
    recommendedOrderUnits: Math.round(recommendedOrderUnits),
    recommendedOrderSpend: round(recommendedOrderSpend),
    highPriorityOrderSpend: round(highPriorityOrderSpend),
    protectedRevenue: round(protectedRevenue),
    deferredSkuCount,
    promotionRevenuePool: round(promotionRevenuePool),
    promotionMarginPool: round(promotionMarginPool),
    supplierPressureCount: supplierSignals.filter((item) => item.statusTone !== "success").length,
  };
}

function buildFallbackModelOutputs(options = {}, context) {
  const forecast = forecastingService.getDemandForecast(options, context);
  const anomalies = anomalyDetectionService.getOperationalAnomalyAlerts(context);
  const stockoutRisks = buildStockoutRisks(forecast);
  const promotionCandidates = buildPromotionCandidates(forecast);
  const dataFoundation = buildDataFoundation(context);
  const supplierSignals = buildSupplierSignals(forecast, context);
  const modelSummary = buildModelSummary(
    forecast,
    anomalies,
    stockoutRisks,
    promotionCandidates,
    dataFoundation,
    supplierSignals
  );

  return {
    ...forecast,
    engine: "node-operational-ml-v3",
    anomalySummary: anomalies.summary,
    anomalyAlerts: anomalies.alerts,
    anomalySeries: anomalies.recentDailySeries,
    stockoutRisks,
    promotionCandidates,
    supplierSignals,
    dataFoundation,
    portfolioSummary: buildPortfolioSummary(forecast, stockoutRisks, promotionCandidates, supplierSignals),
    modelSummary,
  };
}

function normalizeModelOutputs(pythonResult, fallback) {
  if (!pythonResult || typeof pythonResult !== "object") {
    return fallback;
  }

  return {
    ...fallback,
    ...pythonResult,
    overview: {
      ...(fallback.overview || {}),
      ...(pythonResult.overview || {}),
    },
    periods: Array.isArray(pythonResult.periods) ? pythonResult.periods : fallback.periods,
    skuForecasts: mergeModelCollections(fallback.skuForecasts, pythonResult.skuForecasts),
    restockRecommendations: mergeModelCollections(
      fallback.restockRecommendations,
      pythonResult.restockRecommendations
    ),
    anomalySummary: pythonResult.anomalySummary || fallback.anomalySummary,
    anomalyAlerts: Array.isArray(pythonResult.anomalyAlerts)
      ? pythonResult.anomalyAlerts
      : fallback.anomalyAlerts,
    anomalySeries: Array.isArray(pythonResult.anomalySeries)
      ? pythonResult.anomalySeries
      : fallback.anomalySeries,
    stockoutRisks: mergeModelCollections(fallback.stockoutRisks, pythonResult.stockoutRisks),
    promotionCandidates: mergeModelCollections(
      fallback.promotionCandidates,
      pythonResult.promotionCandidates
    ),
    supplierSignals: mergeModelCollections(fallback.supplierSignals, pythonResult.supplierSignals),
    portfolioSummary: pythonResult.portfolioSummary || fallback.portfolioSummary,
    modelSummary: {
      ...(fallback.modelSummary || {}),
      ...(pythonResult.modelSummary || {}),
    },
    dataFoundation: pythonResult.dataFoundation || fallback.dataFoundation,
  };
}

function getOperationalModelOutputs(options = {}, context) {
  const fallback = buildFallbackModelOutputs(options, context);
  const pythonResult = pythonMlService.getOperationalModelOutputs(options, context);
  return normalizeModelOutputs(pythonResult, fallback);
}

module.exports = {
  getOperationalModelOutputs,
};
