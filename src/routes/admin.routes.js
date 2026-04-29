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
router.post(
    "/users",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    adminController.createUser,
);
router.put(
    "/users/:id",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    adminController.updateUser,
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
router.post(
    "/buildings",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    adminController.createBuilding,
);
router.put(
    "/buildings/:id",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    adminController.updateBuilding,
);
router.patch(
    "/buildings/:id/status",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    adminController.toggleBuildingStatus,
);

router.patch(
    "/buildings/:id/admin",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    adminController.assignBuildingAdmin,
);

router.get(
    "/dashboard-stats",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    adminController.getDashboardStats,
);

module.exports = router;
