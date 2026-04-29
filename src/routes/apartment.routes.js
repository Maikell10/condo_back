const express = require("express");
const router = express.Router();
const apartmentController = require("../controllers/apartment.controller");
const authMiddleware = require("../middlewares/auth.middleware");

router.get(
    "/buildings/:buildingId/banks",
    authMiddleware.verifyToken,
    apartmentController.getBankAccounts,
);

// Todas las rutas requieren token y ser Administrador
router.use(authMiddleware.verifyToken, authMiddleware.isBuildingAdmin);

// Obtener todos los apartamentos de un edificio con sus balances
router.get(
    "/building/:buildingId",
    apartmentController.getApartmentsByBuilding,
);

// Actualizar la alícuota de un apartamento específico
router.patch("/:id/alicuota", apartmentController.updateAlicuota);

// Vincular un propietario (User ID) a un apartamento
router.patch("/:id/owner", apartmentController.linkOwner);

// POST /api/apartments
router.post(
    "/",
    authMiddleware.verifyToken,
    authMiddleware.isBuildingAdmin,
    apartmentController.createApartment,
);

router.post(
    "/buildings/banks",
    authMiddleware.verifyToken,
    authMiddleware.isBuildingAdmin,
    apartmentController.createBankAccount,
);
router.put(
    "/buildings/:buildingId/banks",
    authMiddleware.verifyToken,
    authMiddleware.isBuildingAdmin,
    apartmentController.updateBankAccount,
);
router.delete(
    "/buildings/:buildingId/banks",
    authMiddleware.verifyToken,
    authMiddleware.isBuildingAdmin,
    apartmentController.deleteBankAccount,
);

module.exports = router;
