const express = require("express");
const router = express.Router();

const {
  getCustomers,
  getCustomerEnrollmentPreview,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} = require("../controllers/customerController");

const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");

router.use(authMiddleware);

router.get("/", allowRoles("Owner", "Manager", "Cashier"), getCustomers);
router.get("/preview/new", allowRoles("Owner", "Manager", "Cashier"), getCustomerEnrollmentPreview);
router.get("/:id", allowRoles("Owner", "Manager", "Cashier"), getCustomerById);
router.post("/", allowRoles("Owner", "Manager", "Cashier"), createCustomer);
router.put("/:id", allowRoles("Owner", "Manager"), updateCustomer);
router.delete("/:id", allowRoles("Owner"), deleteCustomer);

module.exports = router;
