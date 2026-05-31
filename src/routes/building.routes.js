const express = require("express");
const router = express.Router();
const buildingController = require("../controllers/building.controller");
const authMiddleware = require("../middlewares/auth.middleware");

// Ruta para obtener los edificios de un conjunto residencial
router.get(
    "/managed-buildings",
    authMiddleware.verifyToken,
    authMiddleware.isBuildingAdmin,
    buildingController.getBuildingsByComplex, // <-- Ajusta según dónde pusiste la función
);

module.exports = router;
