const express = require("express");
const router = express.Router();
const receiptController = require("../controllers/receipt.controller");
const authMiddleware = require("../middlewares/auth.middleware");

// Ruta: GET /api/receipts/pending
// Primero verifica el token, luego verifica que sea un OWNER, y finalmente trae los datos
router.get(
    "/pending",
    authMiddleware.verifyToken,
    authMiddleware.isOwner,
    receiptController.getPendingReceipts,
);

module.exports = router;
