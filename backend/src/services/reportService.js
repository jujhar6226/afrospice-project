const analyticsService = require("./analyticsService");
const copilotService = require("./copilotService");
const machineLearningService = require("./machineLearningService");
const reportRepository = require("../data/repositories/reportRepository");
const {
  validateMachineForecastQuery,
  validateOwnerAssistantPayload,
  validateReportRange,
} = require("../validation/reportValidators");

function mapDashboardStatusTrend(items = []) {
  return items.map((item) => ({
    label: item.label,
    time: item.label,
    paidRevenue: item.paidRevenue,
    pendingRevenue: item.pendingRevenue,
    declinedRevenue: item.declinedRevenue,
    totalRevenue: item.totalRevenue,
    totalOrders: item.totalOrders,
    paidRate: item.totalOrders ? (item.paidOrders / item.totalOrders) * 100 : 0,
    atRiskRevenue: Number(item.pendingRevenue || 0) + Number(item.declinedRevenue || 0),
  }));
}

function mapDashboardRevenueTrend(items = []) {
  return items.map((item) => ({
    label: item.label,
    time: item.label,
    revenue: item.revenue,
    orders: item.orders,
    averageOrderValue: item.averageOrderValue,
  }));
}

function escapeCsvCell(value) {
  const normalized = String(value ?? "");
  return `"${normalized.replace(/"/g, '""')}"`;
}

async function loadAnalyticsContext() {
  return analyticsService.getAnalyticsContextAsync();
}

async function getReportsOverview() {
  const context = await loadAnalyticsContext();
  return {
    overview: analyticsService.getOverviewMetrics(context),
    categoryValue: analyticsService.getCategoryValueData(context),
    recentSales: analyticsService.getNormalizedSales(context).slice(-10).reverse(),
  };
}

async function getDashboardSummary() {
  const context = await loadAnalyticsContext();
  const overview = analyticsService.getOverviewMetrics(context);
  const inventorySignals = analyticsService.getInventorySignals(context);
  const inventoryIntel = analyticsService.getInventoryIntelligence(context);
  const monthlyReports = analyticsService.getReportsDataset("monthly", context);
  const dashboardDecisionModel = analyticsService.getDashboardDecisionModel(context);
  const businessPulse = analyticsService.getBusinessPulse("monthly", context);
  const topCashiers = analyticsService.getTopCashiers(3, context);
  const paymentMethodBreakdown = analyticsService.getPaymentMethodBreakdown(context);
  const channelBreakdown = analyticsService.getChannelBreakdown(context);
  const tradingWindows = analyticsService.getDaypartPerformance(context);
  const mlForecast = machineLearningService.getOperationalModelOutputs(
    {
      range: "daily",
      horizon: 14,
      limit: 6,
    },
    context
  );

  return {
    stats: {
      totalRevenue: overview.totalRevenue,
      capturedRevenue: overview.paidRevenue,
      ordersCount: overview.totalOrders,
      avgOrderValue: overview.averageOrderValue,
      paidRate: overview.paidRate,
      paidOrders: overview.paidOrders,
      pendingOrders: overview.pendingOrders,
      declinedOrders: overview.declinedOrders,
      pendingRevenue: overview.pendingRevenue,
      declinedRevenue: overview.declinedRevenue,
      inventoryValue: overview.totalInventoryValue,
      lowStockCount: inventorySignals.lowStockCount,
      outOfStockCount: inventorySignals.outOfStockCount,
      healthScore: Math.min(
        98,
        Math.max(
          24,
          Math.round(
            100 -
              inventorySignals.outOfStockCount * 12 -
              inventorySignals.lowStockCount * 3 -
              Number(inventoryIntel?.summary?.dormantStockCount || 0) * 2
          )
        )
      ),
    },
    revenueTrend: mapDashboardRevenueTrend(analyticsService.getSalesTrend("daily", context)),
    statusTrend: mapDashboardStatusTrend(analyticsService.getStatusTrend("daily", context)),
    lowStock: inventorySignals.lowStockProducts.map((item) => ({
      name: item.name,
      stock: Number(item.stock || 0),
      category: item.category || "General",
    })),
    recentSales: analyticsService.getNormalizedSales(context).slice(-5).reverse(),
    businessPulse,
    forecast: monthlyReports.forecast,
    categoryBreakdown: monthlyReports.categoryBreakdown.slice(0, 6),
    topProducts: monthlyReports.topProducts.slice(0, 5),
    topCashiers,
    paymentMethodBreakdown,
    channelBreakdown,
    tradingWindows,
    dailyBriefing: dashboardDecisionModel.dailyBriefing,
    whatChanged: dashboardDecisionModel.whatChanged,
    smartAlerts: dashboardDecisionModel.smartAlerts,
    recommendations: dashboardDecisionModel.recommendations,
    customerIntelligence: dashboardDecisionModel.customerIntelligence,
    staffingIntelligence: dashboardDecisionModel.staffingIntelligence,
    forecastSignals: dashboardDecisionModel.forecastSignals,
    scenarioDefaults: dashboardDecisionModel.scenarioDefaults,
    mlForecast,
  };
}

async function getOrderAnalytics(query = {}) {
  const range = validateReportRange(query.range, "monthly");
  const context = await loadAnalyticsContext();
  const reports = analyticsService.getReportsDataset(range, context);

  return {
    range,
    summary: reports.summary,
    trend: reports.trend,
    statusTrend: reports.statusTrend,
    statusBreakdown: analyticsService.getStatusBreakdown(context),
    revenueByStatus: analyticsService.getRevenueByStatus(context),
    paymentMethodBreakdown: analyticsService.getPaymentMethodBreakdown(context),
    channelBreakdown: analyticsService.getChannelBreakdown(context),
    daypartPerformance: reports.daypartPerformance,
    pulse: analyticsService.getBusinessPulse(range, context),
    recentOrders: analyticsService.getNormalizedSales(context).slice(-10).reverse(),
    topCashiers: analyticsService.getTopCashiers(5, context),
  };
}

async function getBusinessPulse(query = {}) {
  const range = validateReportRange(query.range, "monthly");
  const context = await loadAnalyticsContext();
  return {
    range,
    signals: analyticsService.getBusinessPulse(range, context),
  };
}

async function getInventoryIntelligence() {
  const context = await loadAnalyticsContext();
  return analyticsService.getInventoryIntelligence(context);
}

async function getCustomerAnalytics(query = {}) {
  const range = validateReportRange(query.range, "monthly");
  const context = await loadAnalyticsContext();
  return analyticsService.getCustomersDataset(range, context);
}

async function getSupplierAnalytics(query = {}) {
  const range = validateReportRange(query.range, "monthly");
  const context = await loadAnalyticsContext();
  return analyticsService.getSuppliersDataset(range, context);
}

async function getNotifications() {
  const context = await loadAnalyticsContext();
  const overview = analyticsService.getOverviewMetrics(context);
  const inventorySignals = analyticsService.getInventorySignals(context);
  const inventoryIntel = analyticsService.getInventoryIntelligence(context);
  const supplierIntel = analyticsService.getSuppliersDataset("monthly", context);
  const latestObservedAt = context.latestObservedAt || new Date();
  const pendingExposure = Number(overview.pendingRevenue || 0) + Number(overview.declinedRevenue || 0);
  const openCommitmentValue = Number(supplierIntel?.summary?.openCommitmentValue || 0);
  const items = [];

  if (inventorySignals.lowStockCount > 0) {
    const leadSku = inventorySignals.lowStockProducts?.[0];
    items.push({
      id: "low-stock-watch",
      tone: "warning",
      title: `${inventorySignals.lowStockCount} low-stock SKUs need action`,
      detail: leadSku
        ? `${leadSku.name} is leading the pressure queue with ${leadSku.stock} units left on hand.`
        : "Low-stock lines are active in the current catalog.",
      generatedAt: latestObservedAt,
      action: {
        label: "Open inventory",
        path: "/pos-dashboard",
        focus: "inventory-directory",
        note: "Inventory pressure is visible in the current stock directory.",
      },
    });
  }

  if (pendingExposure > 0 || Number(overview.pendingOrders || 0) > 0) {
    items.push({
      id: "order-capture-watch",
      tone: "danger",
      title: `${Number(overview.pendingOrders || 0)} orders still need clean capture`,
      detail: `${pendingExposure.toFixed(2)} in unsettled order value is still sitting outside captured revenue.`,
      generatedAt: latestObservedAt,
      action: {
        label: "Open orders",
        path: "/orders",
        focus: "orders-ledger",
        note: "Order settlement and capture issues need review in the live ledger.",
      },
    });
  }

  if (openCommitmentValue > 0) {
    items.push({
      id: "supplier-commitment-watch",
      tone: "neutral",
      title: "Supplier commitments are still open",
      detail: `${openCommitmentValue.toFixed(2)} is still waiting to land across live purchase orders.`,
      generatedAt: latestObservedAt,
      action: {
        label: "Open suppliers",
        path: "/suppliers",
        note: "Supplier pressure is active across the current procurement view.",
      },
    });
  }

  if (Number(inventoryIntel?.summary?.dormantStockCount || 0) > 0) {
    items.push({
      id: "dormant-capital-watch",
      tone: "warning",
      title: "Dormant inventory is tying up capital",
      detail: `${Number(inventoryIntel.summary.dormantStockCount || 0)} lines are moving slowly and should be reviewed against active demand.`,
      generatedAt: latestObservedAt,
      action: {
        label: "Open planner",
        path: "/pos-dashboard",
        focus: "inventory-reorder",
        note: "Dormant capital and reorder pressure are visible in the planner.",
      },
    });
  }

  return {
    generatedAt: latestObservedAt,
    unreadCount: items.length,
    items: items.slice(0, 6),
  };
}

async function getOwnerAssistantBootstrap() {
  return copilotService.getOwnerAssistantBootstrap();
}

async function getOwnerAssistantReply(payload) {
  const { question, history } = validateOwnerAssistantPayload(payload);
  return copilotService.getOwnerAssistantReply(question, history);
}

async function getMachineForecast(query = {}) {
  const context = await loadAnalyticsContext();
  const options = validateMachineForecastQuery(query, "daily");
  return machineLearningService.getOperationalModelOutputs(options, context);
}

async function getAdvancedReports(query = {}) {
  const range = validateReportRange(query.range, "monthly");
  const context = await loadAnalyticsContext();
  const options = validateMachineForecastQuery(query, range);

  return {
    ...analyticsService.getReportsDataset(range, context),
    mlForecast: machineLearningService.getOperationalModelOutputs(options, context),
  };
}

async function exportReportsCsv() {
  const sales = await reportRepository.getSales();
  const rows = [
    ["Order ID", "Customer", "Cashier", "Status", "Channel", "Payment Method", "Total", "Date"].join(","),
    ...sales.map((sale) =>
      [
        escapeCsvCell(sale.id || ""),
        escapeCsvCell(sale.customer || "Walk-in Customer"),
        escapeCsvCell(sale.cashier || "Front Desk"),
        escapeCsvCell(sale.status || "Paid"),
        escapeCsvCell(sale.channel || "In-Store"),
        escapeCsvCell(sale.paymentMethod || "Card"),
        Number(sale.total || 0),
        escapeCsvCell(sale.date || ""),
      ].join(",")
    ),
  ];

  return {
    filename: "afrospice-reports.csv",
    contentType: "text/csv",
    body: rows.join("\n"),
  };
}

module.exports = {
  getReportsOverview,
  getDashboardSummary,
  getOrderAnalytics,
  getBusinessPulse,
  getInventoryIntelligence,
  getCustomerAnalytics,
  getSupplierAnalytics,
  getNotifications,
  getOwnerAssistantBootstrap,
  getOwnerAssistantReply,
  getMachineForecast,
  getAdvancedReports,
  exportReportsCsv,
};
