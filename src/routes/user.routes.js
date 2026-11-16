const express = require("express");
const router = express.Router();
const userController = require("../controllers/user.controller");
const authMiddleware = require("../middlewares/auth.middleware");

// GET /api/users/search?term=...
// Protegido para que solo administradores busquen propietarios
router.get(
    "/search",
    authMiddleware.verifyToken,
    authMiddleware.isBuildingAdmin,
    userController.searchUsers,
);

router.get(
    "/me",
    authMiddleware.verifyToken,
    authMiddleware.isOwner,
    userController.getMyOwnerProfile,
);

router.put(
    "/me",
    authMiddleware.verifyToken,
    authMiddleware.isOwner,
    userController.updateMyOwnerProfile,
);

router.put(
    "/owners/:ownerId/profile",
    authMiddleware.verifyToken,
    authMiddleware.isBuildingAdmin,
    userController.updateOwnerProfileByBuildingAdmin,
);

module.exports = router;
