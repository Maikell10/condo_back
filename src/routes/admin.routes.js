const express = require("express");
const router = express.Router();
const adminController = require("../controllers/admin.controller");
const authMiddleware = require("../middlewares/auth.middleware");

router.get(
    "/users",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    adminController.getAllUsers,
);
router.patch(
    "/users/:id/status",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    adminController.toggleUserStatus,
);

router.get(
    "/buildings",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    adminController.getBuildings,
);
router.patch(
    "/buildings/:id/status",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    adminController.toggleBuildingStatus,
);

module.exports = router;
