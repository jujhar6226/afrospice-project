const systemService = require("../services/systemService");
const asyncHandler = require("../utils/asyncHandler");
const { success } = require("../utils/response");

const getHealth = asyncHandler(async (req, res) => {
  return success(res, systemService.getHealth(), "System health fetched.");
});

const getReadiness = asyncHandler(async (req, res) => {
  const payload = await systemService.getReadinessReport();
  const statusCode = payload?.summary?.status === "not_ready" ? 503 : 200;
  return res.status(statusCode).json({
    success: statusCode < 400,
    message: "System readiness fetched.",
    data: payload,
  });
});

const getHealthDetails = asyncHandler(async (req, res) => {
  return success(res, await systemService.getHealthDetails(), "System diagnostics fetched.");
});

const getAiStatus = asyncHandler(async (req, res) => {
  return success(res, systemService.getAiStatus(), "AI status fetched.");
});

const exportBackup = asyncHandler(async (req, res) => {
  const snapshot = await systemService.getBackupSnapshot();
  const dateStamp = new Date().toISOString().slice(0, 10);

  res.header("Content-Type", "application/json");
  res.attachment(`afrospice-backup-${dateStamp}.json`);
  return res.send(JSON.stringify(snapshot, null, 2));
});

module.exports = {
  getHealth,
  getReadiness,
  getHealthDetails,
  getAiStatus,
  exportBackup,
};
