const express = require("express");
const router = express.Router();

const {
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
} = require("../controllers/reportController");

const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");

router.use(authMiddleware);

router.get("/overview", allowRoles("Owner", "Manager"), getReportsOverview);
router.get("/dashboard", allowRoles("Owner", "Manager"), getDashboardSummary);
router.get("/orders", allowRoles("Owner", "Manager"), getOrderAnalytics);
router.get("/business-pulse", allowRoles("Owner", "Manager"), getBusinessPulse);
router.get("/inventory-intelligence", allowRoles("Owner", "Manager"), getInventoryIntelligence);
router.get("/customers", allowRoles("Owner", "Manager"), getCustomerAnalytics);
router.get("/suppliers", allowRoles("Owner", "Manager", "Inventory Clerk"), getSupplierAnalytics);
router.get("/notifications", allowRoles("Owner", "Manager", "Cashier", "Inventory Clerk"), getNotifications);
router.get("/ml-forecast", allowRoles("Owner", "Manager"), getMachineForecast);
router.get(
  "/owner-assistant",
  allowRoles("Owner", "Manager", "Cashier", "Inventory Clerk"),
  getOwnerAssistantBootstrap
);
router.post(
  "/owner-assistant",
  allowRoles("Owner", "Manager", "Cashier", "Inventory Clerk"),
  postOwnerAssistantChat
);
router.get("/export", allowRoles("Owner", "Manager"), exportReportsCsv);
router.get("/", allowRoles("Owner", "Manager"), getAdvancedReports);

module.exports = router;
