const purchaseOrderService = require("../services/purchaseOrderService");
const asyncHandler = require("../utils/asyncHandler");
const { success, created } = require("../utils/response");

const listPurchaseOrders = asyncHandler(async (req, res) => {
  return success(
    res,
    await purchaseOrderService.listPurchaseOrders(req.query.limit),
    "Purchase orders fetched."
  );
});

const getPurchaseOrderById = asyncHandler(async (req, res) => {
  return success(
    res,
    await purchaseOrderService.getPurchaseOrderById(req.params.id),
    "Purchase order fetched."
  );
});

const createPurchaseOrder = asyncHandler(async (req, res) => {
  return created(
    res,
    await purchaseOrderService.createPurchaseOrder(req.body || {}, req.user),
    "Purchase order created successfully."
  );
});

const createBulkDraftPurchaseOrders = asyncHandler(async (req, res) => {
  const result = await purchaseOrderService.createBulkDraftPurchaseOrders(req.body || {}, req.user);
  return created(
    res,
    result,
    result.createdCount === 1 ? "Purchase order draft created." : "Purchase order drafts created."
  );
});

const updatePurchaseOrderStatus = asyncHandler(async (req, res) => {
  return success(
    res,
    await purchaseOrderService.updatePurchaseOrderStatus(req.params.id, req.body || {}, req.user),
    "Purchase order status updated."
  );
});

const receivePurchaseOrder = asyncHandler(async (req, res) => {
  return success(
    res,
    await purchaseOrderService.receivePurchaseOrder(req.params.id, req.body || {}, req.user),
    "Purchase order received successfully."
  );
});

module.exports = {
  listPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  createBulkDraftPurchaseOrders,
  updatePurchaseOrderStatus,
  receivePurchaseOrder,
};
