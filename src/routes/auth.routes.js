const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");

// La ruta final será: /api/auth/login
router.post("/login", authController.login);

// Aquí a futuro puedes agregar:
// router.post('/register', authController.register);
// router.post('/forgot-password', authController.forgotPassword);

module.exports = router;
