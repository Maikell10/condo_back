const express = require("express");
const router = express.Router();
const saasController = require("../controllers/saas.controller");
const { verifyToken, isAdmin } = require("../middlewares/auth.middleware"); // Ajusta a tus middlewares

// Todas las rutas están protegidas
router.use(verifyToken, isAdmin); // Usa tu middleware que verifique que el rol sea SUPER_ADMIN

router.get("/dashboard", saasController.getSaaSDashboard);
router.post("/subscription", saasController.updateSubscription);
router.post("/payment", saasController.registerPayment);
router.get("/history/:admin_id", saasController.getPaymentHistory);

// 🔥 RUTA PARA EL CRON JOB
// Esta ruta la puedes llamar desde tu gestor de Crons
router.get("/cron/generate-invoices", saasController.generateMonthlyInvoices);

module.exports = router;
