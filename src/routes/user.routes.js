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

module.exports = router;
