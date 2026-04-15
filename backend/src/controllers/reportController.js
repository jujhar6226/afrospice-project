const reportService = require("../services/reportService");
const asyncHandler = require("../utils/asyncHandler");
const { success } = require("../utils/response");

const getReportsOverview = asyncHandler(async (req, res) => {
  return success(res, await reportService.getReportsOverview(), "Reports overview fetched.");
});

const getDashboardSummary = asyncHandler(async (req, res) => {
  return success(res, await reportService.getDashboardSummary(), "Dashboard summary fetched.");
});

const getOrderAnalytics = asyncHandler(async (req, res) => {
  return success(
    res,
    await reportService.getOrderAnalytics(req.query || {}),
    "Order analytics fetched."
  );
});

const getBusinessPulse = asyncHandler(async (req, res) => {
  return success(
    res,
    await reportService.getBusinessPulse(req.query || {}),
    "Business pulse fetched."
  );
});

const getInventoryIntelligence = asyncHandler(async (req, res) => {
  return success(
    res,
    await reportService.getInventoryIntelligence(),
    "Inventory intelligence fetched."
  );
});

const getCustomerAnalytics = asyncHandler(async (req, res) => {
  return success(
    res,
    await reportService.getCustomerAnalytics(req.query || {}),
    "Customer analytics fetched."
  );
});

const getSupplierAnalytics = asyncHandler(async (req, res) => {
  return success(
    res,
    await reportService.getSupplierAnalytics(req.query || {}),
    "Supplier analytics fetched."
  );
});

const getOwnerAssistantBootstrap = asyncHandler(async (req, res) => {
  return success(
    res,
    await reportService.getOwnerAssistantBootstrap(),
    "Owner assistant bootstrap fetched."
  );
});

const getNotifications = asyncHandler(async (req, res) => {
  return success(
    res,
    await reportService.getNotifications(),
    "Workspace notifications fetched."
  );
});

const postOwnerAssistantChat = asyncHandler(async (req, res) => {
  return success(
    res,
    await reportService.getOwnerAssistantReply(req.body || {}),
    "Owner assistant reply fetched."
  );
});

const getMachineForecast = asyncHandler(async (req, res) => {
  return success(
    res,
    await reportService.getMachineForecast(req.query || {}),
    "Machine forecast fetched."
  );
});

const getAdvancedReports = asyncHandler(async (req, res) => {
  return success(
    res,
    await reportService.getAdvancedReports(req.query || {}),
    "Advanced reports fetched."
  );
});

const exportReportsCsv = asyncHandler(async (req, res) => {
  const exportFile = await reportService.exportReportsCsv();
  res.header("Content-Type", exportFile.contentType);
  res.attachment(exportFile.filename);
  return res.send(exportFile.body);
});

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
  postOwnerAssistantChat,
  getMachineForecast,
  getAdvancedReports,
  exportReportsCsv,
};
