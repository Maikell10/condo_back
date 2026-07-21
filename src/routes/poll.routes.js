const express = require("express");
const router = express.Router();
const pollController = require("../controllers/poll.controller");
const authMiddleware = require("../middlewares/auth.middleware");

// ==========================================
// RUTAS PARA EL ADMINISTRADOR
// ==========================================

// Crear una nueva encuesta
// POST /api/polls
router.post(
    "/",
    authMiddleware.verifyToken,
    authMiddleware.isBuildingAdmin, // O isBuildingAdmin (usa el middleware que tengas para el admin)
    pollController.createPoll,
);

// ==========================================
// RUTAS PARA EL PROPIETARIO
// ==========================================

// Registrar un voto
// POST /api/polls/vote
router.post(
    "/vote",
    authMiddleware.verifyToken,
    authMiddleware.isOwner,
    pollController.castVote,
);

// ==========================================
// RUTAS COMPARTIDAS (AMBOS)
// ==========================================

// Obtener los detalles y resultados de una encuesta específica
// GET /api/polls/:pollId/results
router.get(
    "/:pollId/results",
    authMiddleware.verifyToken,
    pollController.getPollResults,
);

module.exports = router;
