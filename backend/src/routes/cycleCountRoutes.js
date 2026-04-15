const express = require("express");
const router = express.Router();

const {
  listCycleCounts,
  getCycleCountById,
  createQuickCycleCount,
  completeCycleCount,
} = require("../controllers/cycleCountController");

const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");

router.use(authMiddleware);

router.get("/", allowRoles("Owner", "Manager", "Inventory Clerk"), listCycleCounts);
router.get("/:id", allowRoles("Owner", "Manager", "Inventory Clerk"), getCycleCountById);
router.post("/quick-draft", allowRoles("Owner", "Manager", "Inventory Clerk"), createQuickCycleCount);
router.post("/:id/complete", allowRoles("Owner", "Manager", "Inventory Clerk"), completeCycleCount);

module.exports = router;
