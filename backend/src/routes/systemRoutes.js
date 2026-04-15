const express = require("express");
const router = express.Router();

const {
  getHealth,
  getReadiness,
  getHealthDetails,
  getAiStatus,
  exportBackup,
} = require("../controllers/systemController");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");

router.get("/health", getHealth);
router.get("/readiness", getReadiness);
router.get("/health/details", authMiddleware, allowRoles("Owner", "Manager"), getHealthDetails);
router.get("/ai-status", authMiddleware, allowRoles("Owner", "Manager"), getAiStatus);
router.get("/backup", authMiddleware, allowRoles("Owner", "Manager"), exportBackup);

module.exports = router;
