const settingsService = require("../services/settingsService");
const asyncHandler = require("../utils/asyncHandler");
const { success } = require("../utils/response");

const getPublicSettings = asyncHandler(async (req, res) => {
  return success(res, await settingsService.getPublicSettings(), "Public settings fetched.");
});

const getSettings = asyncHandler(async (req, res) => {
  return success(res, await settingsService.getSettings(), "Settings fetched.");
});

const updateSettings = asyncHandler(async (req, res) => {
  return success(
    res,
    await settingsService.updateSettings(req.body || {}, req.user),
    "Settings updated."
  );
});

module.exports = {
  getPublicSettings,
  getSettings,
  updateSettings,
};
