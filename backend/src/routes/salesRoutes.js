const express = require("express");
const router = express.Router();

const {
  getSales,
  getSaleById,
  createSale,
  updateSaleStatus
} = require("../controllers/salesController");

const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");

router.use(authMiddleware);

router.get("/", allowRoles("Owner", "Manager", "Cashier"), getSales);
router.get("/:id", allowRoles("Owner", "Manager", "Cashier"), getSaleById);
router.post("/", allowRoles("Owner", "Manager", "Cashier"), createSale);
router.patch("/:id/status", allowRoles("Owner", "Manager", "Cashier"), updateSaleStatus);

module.exports = router;
