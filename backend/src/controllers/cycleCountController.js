const cycleCountService = require("../services/cycleCountService");
const asyncHandler = require("../utils/asyncHandler");
const { success, created } = require("../utils/response");

const listCycleCounts = asyncHandler(async (req, res) => {
  return success(
    res,
    await cycleCountService.listCycleCounts(req.query.limit),
    "Cycle counts fetched."
  );
});

const getCycleCountById = asyncHandler(async (req, res) => {
  return success(
    res,
    await cycleCountService.getCycleCountById(req.params.id),
    "Cycle count fetched."
  );
});

const createQuickCycleCount = asyncHandler(async (req, res) => {
  return created(
    res,
    await cycleCountService.createQuickCycleCount(req.body || {}, req.user),
    "Cycle count created successfully."
  );
});

const completeCycleCount = asyncHandler(async (req, res) => {
  return success(
    res,
    await cycleCountService.completeCycleCount(req.params.id, req.body || {}, req.user),
    "Cycle count completed successfully."
  );
});

module.exports = {
  listCycleCounts,
  getCycleCountById,
  createQuickCycleCount,
  completeCycleCount,
};
