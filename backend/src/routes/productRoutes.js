const express = require("express");
const router = express.Router();

const {
  getProducts,
  getProductById,
  getRecentInventoryMovements,
  getProductMovements,
  createProduct,
  updateProduct,
  deleteProduct,
  restockProduct,
  getProductByBarcode
} = require("../controllers/productController");

const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");


// =====================
// 🔓 PUBLIC ROUTES (NO AUTH)
// =====================

// Get all products (for POS app)
router.get("/", getProducts);

// Scan barcode (for POS app)
router.get("/barcode/:code", getProductByBarcode);


// =====================
// 🔐 PROTECTED ROUTES (ADMIN / MANAGEMENT)
// =====================

router.use(authMiddleware);

// Inventory / analytics
router.get("/movements/recent", getRecentInventoryMovements);
router.get("/:id/movements", getProductMovements);
router.get("/:id", getProductById);

// Product management
router.post("/", allowRoles("Owner", "Manager", "Inventory Clerk"), createProduct);
router.put("/:id", allowRoles("Owner", "Manager", "Inventory Clerk"), updateProduct);
router.patch("/:id/restock", allowRoles("Owner", "Manager", "Inventory Clerk"), restockProduct);
router.delete("/:id", allowRoles("Owner", "Manager"), deleteProduct);


module.exports = router;