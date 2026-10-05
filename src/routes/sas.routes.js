const express = require("express");
const router = express.Router();
const saasController = require("../controllers/sas.controller");
const { verifyToken, isSuperAdmin } = require("../middlewares/auth.middleware");
const {
    assertCronAuthorized,
} = require("../middlewares/cron-auth.middleware");

router.get(
    "/cron/generate-invoices",
    assertCronAuthorized,
    saasController.generateMonthlyInvoices,
);

// Todas las rutas están protegidas
router.use(verifyToken, isSuperAdmin); // Usa tu middleware que verifique que el rol sea SUPER_ADMIN

router.get("/dashboard", saasController.getSaaSDashboard);
router.post("/subscription", saasController.updateSubscription);
router.post("/payment", saasController.registerPayment);
router.get("/history", saasController.getAllPaymentHistory);
router.get("/history/:admin_id", saasController.getPaymentHistory);
router.get("/invoice-document/:invoice_id", saasController.getInvoiceDocument);
router.get("/invoices/:admin_id", saasController.getAdminInvoices);

module.exports = router;
