const express = require("express");
const router = express.Router();
const tasaCambioController = require("../controllers/tasaCambio.controller");
const authMiddleware = require("../middlewares/auth.middleware");

router.get("/get_tasa/usd", tasaCambioController.getTasa);

router.get(
    "/admin/usd",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    tasaCambioController.getTasaAdmin,
);

router.put(
    "/admin/usd",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    tasaCambioController.putTasaUsd,
);

router.post(
    "/admin/refresh-bcv",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    tasaCambioController.postRefreshTasaBCV,
);

// Creamos un endpoint para que Vercel lo ejecute externamente
router.get("/cron/update-tasa", async (req, res) => {
    try {
        console.log("[VERCEL CRON] Petición externa recibida de Vercel...");
        await tasaCambioController.setTasaBCV();
        res.status(200).json({
            success: true,
            message: "Cron ejecutado con éxito",
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
