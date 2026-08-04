const express = require("express");
const router = express.Router();
const settingsController = require("../controllers/settings.controller");
const authMiddleware = require("../middlewares/auth.middleware");

// Ruta: GET /api/settings/
// Primero verifica el token, luego verifica que sea un OWNER, y finalmente trae los datos
router.get(
    "/building_admin",
    authMiddleware.verifyToken,
    authMiddleware.isBuildingAdmin,
    settingsController.getSettings,
);

router.put(
    "/building_admin",
    authMiddleware.verifyToken,
    authMiddleware.isBuildingAdmin,
    settingsController.updateSettings,
);

module.exports = router;
