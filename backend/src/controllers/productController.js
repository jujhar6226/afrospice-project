const productService = require("../services/productService");
const asyncHandler = require("../utils/asyncHandler");
const { success, created } = require("../utils/response");


const getProductByBarcode = asyncHandler(async (req, res) => {
  const { code } = req.params;

  const product = await productService.getProductByBarcode(code);

  return success(res, product, "Product fetched by barcode.");
});

const getProducts = asyncHandler(async (req, res) => {
  return success(res, await productService.getProducts(), "Products fetched.");
});

const getProductById = asyncHandler(async (req, res) => {
  return success(res, await productService.getProductById(req.params.id), "Product fetched.");
});

const getRecentInventoryMovements = asyncHandler(async (req, res) => {
  return success(
    res,
    await productService.getRecentInventoryMovements(req.query.limit),
    "Inventory movements fetched."
  );
});

const getProductMovements = asyncHandler(async (req, res) => {
  return success(
    res,
    await productService.getProductMovements(req.params.id, req.query.limit),
    "Product movements fetched."
  );
});

const createProduct = asyncHandler(async (req, res) => {
  return created(
    res,
    await productService.createProduct(req.body || {}, req.user),
    "Product created successfully."
  );
});

const updateProduct = asyncHandler(async (req, res) => {
  return success(
    res,
    await productService.updateProduct(req.params.id, req.body || {}, req.user),
    "Product updated successfully."
  );
});

const deleteProduct = asyncHandler(async (req, res) => {
  return success(
    res,
    await productService.deleteProduct(req.params.id, req.user),
    "Product deleted successfully."
  );
});

const restockProduct = asyncHandler(async (req, res) => {
  return success(
    res,
    await productService.restockProduct(req.params.id, req.body || {}, req.user),
    "Product restocked successfully."
  );
});

module.exports = {
  getProducts,
  getProductById,
  getRecentInventoryMovements,
  getProductMovements,
  createProduct,
  updateProduct,
  deleteProduct,
  restockProduct,
  getProductByBarcode // ✅ ADD THIS
};