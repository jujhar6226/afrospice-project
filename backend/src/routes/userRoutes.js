const express = require("express");
const router = express.Router();

const {
  getUsers,
  getUser,
  getUserAccessEvents,
  getUserOversight,
  createUser,
  updateUser,
  updateUserWorkforceProfile,
  assignUserPin,
  approveUser,
  updateUserStatus,
  exportUserAudit,
  exportSingleUserAudit,
  getSavedUserViews,
  saveUserView,
  deleteSavedUserView,
  deleteUser
} = require("../controllers/userController");

const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");

router.use(authMiddleware);

router.get("/views", allowRoles("Owner", "Manager"), getSavedUserViews);
router.post("/views", allowRoles("Owner"), saveUserView);
router.delete("/views/:viewId", allowRoles("Owner"), deleteSavedUserView);
router.get("/", allowRoles("Owner", "Manager"), getUsers);
router.get("/audit-export", allowRoles("Owner", "Manager"), exportUserAudit);
router.get("/:id/audit-export", allowRoles("Owner", "Manager"), exportSingleUserAudit);
router.get("/:id/events", allowRoles("Owner", "Manager"), getUserAccessEvents);
router.get("/:id/oversight", allowRoles("Owner", "Manager"), getUserOversight);
router.get("/:id", allowRoles("Owner", "Manager"), getUser);
router.post("/", allowRoles("Owner"), createUser);
router.post("/:id/pin", allowRoles("Owner"), assignUserPin);
router.post("/:id/approve", allowRoles("Owner"), approveUser);
router.patch("/:id/status", allowRoles("Owner"), updateUserStatus);
router.patch("/:id/workforce-profile", allowRoles("Owner"), updateUserWorkforceProfile);
router.put("/:id", allowRoles("Owner"), updateUser);
router.delete("/:id", allowRoles("Owner"), deleteUser);

module.exports = router;
