const salesService = require("../services/salesService");
const asyncHandler = require("../utils/asyncHandler");
const { success, created } = require("../utils/response");

const getSales = asyncHandler(async (req, res) => {
  return success(res, await salesService.getSales(), "Sales fetched.");
});

const getSaleById = asyncHandler(async (req, res) => {
  return success(res, await salesService.getSaleById(req.params.id), "Sale fetched.");
});

const createSale = asyncHandler(async (req, res) => {
  return created(
    res,
    await salesService.createSale(req.body || {}, req.user),
    "Sale recorded successfully."
  );
});

const updateSaleStatus = asyncHandler(async (req, res) => {
  return success(
    res,
    await salesService.updateSaleStatus(req.params.id, req.body || {}, req.user),
    "Sale status updated successfully."
  );
});

module.exports = {
  getSales,
  getSaleById,
  createSale,
  updateSaleStatus,
};
