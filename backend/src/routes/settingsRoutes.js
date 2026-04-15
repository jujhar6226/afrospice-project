const express = require("express");

const { getPublicSettings, getSettings, updateSettings } = require("../controllers/settingsController");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");

const router = express.Router();

router.get("/public", getPublicSettings);
router.get("/", authMiddleware, allowRoles("Owner", "Manager"), getSettings);
router.put("/", authMiddleware, allowRoles("Owner", "Manager"), updateSettings);

module.exports = router;
