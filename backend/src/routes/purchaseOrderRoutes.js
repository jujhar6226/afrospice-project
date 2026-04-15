const express = require("express");
const router = express.Router();

const {
  listPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  createBulkDraftPurchaseOrders,
  updatePurchaseOrderStatus,
  receivePurchaseOrder,
} = require("../controllers/purchaseOrderController");

const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");

router.use(authMiddleware);

router.get("/", allowRoles("Owner", "Manager", "Inventory Clerk"), listPurchaseOrders);
router.get("/:id", allowRoles("Owner", "Manager", "Inventory Clerk"), getPurchaseOrderById);
router.post("/", allowRoles("Owner", "Manager", "Inventory Clerk"), createPurchaseOrder);
router.post("/bulk-draft", allowRoles("Owner", "Manager", "Inventory Clerk"), createBulkDraftPurchaseOrders);
router.patch("/:id/status", allowRoles("Owner", "Manager", "Inventory Clerk"), updatePurchaseOrderStatus);
router.post("/:id/receive", allowRoles("Owner", "Manager", "Inventory Clerk"), receivePurchaseOrder);

module.exports = router;
