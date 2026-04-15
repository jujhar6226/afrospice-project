const supplierService = require("../services/supplierService");
const asyncHandler = require("../utils/asyncHandler");
const { success, created } = require("../utils/response");

const getSuppliers = asyncHandler(async (req, res) => {
  return success(res, await supplierService.getSuppliers(req.query || {}), "Suppliers fetched.");
});

const getSupplierById = asyncHandler(async (req, res) => {
  return success(res, await supplierService.getSupplierById(req.params.id), "Supplier fetched.");
});

const createSupplier = asyncHandler(async (req, res) => {
  return created(
    res,
    await supplierService.createSupplier(req.body || {}, req.user),
    "Supplier created successfully."
  );
});

const updateSupplier = asyncHandler(async (req, res) => {
  return success(
    res,
    await supplierService.updateSupplier(req.params.id, req.body || {}, req.user),
    "Supplier updated successfully."
  );
});

const deleteSupplier = asyncHandler(async (req, res) => {
  return success(
    res,
    await supplierService.deleteSupplier(req.params.id, req.user),
    "Supplier deleted successfully."
  );
});

module.exports = {
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
};
