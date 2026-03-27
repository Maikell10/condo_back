// src/routes/audit.routes.js
const express = require("express");
const router = express.Router();
const auditController = require("../controllers/audit.controller");
const authMiddleware = require("../middlewares/auth.middleware");

// Protección de Ruta: Solo accesible para Superadministradores con token válido
router.get(
    "/",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    auditController.getAuditLogs,
);

module.exports = router;
