const express = require("express");
const router = express.Router();
const conceptController = require("../controllers/concept.controller");
const authMiddleware = require("../middlewares/auth.middleware");

// GET /api/concepts - Público para usuarios autenticados (Admin y SuperAdmin)
router.get("/", authMiddleware.verifyToken, conceptController.getConcepts);

// POST /api/concepts - Solo el Super Admin puede crear nuevos conceptos
router.post(
    "/",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    conceptController.createConcept,
);

module.exports = router;
