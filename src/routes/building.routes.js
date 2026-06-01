const express = require("express");
const router = express.Router();
const multer = require("multer");
const buildingController = require("../controllers/building.controller");
const authMiddleware = require("../middlewares/auth.middleware");

// 🔥 CORRECCIÓN: Usar MemoryStorage en lugar de 'dest: uploads/'
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// IMPORTANTE: 'file' es el nombre del campo que enviará Angular en el FormData
router.post(
    "/import-complex-data",
    upload.single("file"),
    buildingController.importComplexData,
);

// Ruta para obtener los edificios de un conjunto residencial
router.get(
    "/managed-buildings",
    authMiddleware.verifyToken,
    authMiddleware.isBuildingAdmin,
    buildingController.getBuildingsByComplex, // <-- Ajusta según dónde pusiste la función
);

module.exports = router;
