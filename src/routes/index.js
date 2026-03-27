const express = require("express");
const router = express.Router();

// Importar las rutas específicas
const authRoutes = require("./auth.routes");
const receiptRoutes = require("./receipt.routes");
const paymentRoutes = require("./payment.routes");
const billingRoutes = require("./billing.routes");
const conceptRoutes = require("./concept.routes");
const apartmentRoutes = require("./apartment.routes");
const userRoutes = require("./user.routes");
const contractRoutes = require("./contract.routes");
const dashboardtRoutes = require("./dashboard.routes");
const adminRoutes = require("./admin.routes");
const auditRoutes = require("./audit.routes");

// Definir los prefijos para cada grupo de rutas
router.use("/auth", authRoutes);
router.use("/receipts", receiptRoutes);
router.use("/payments", paymentRoutes);
router.use("/billing", billingRoutes);
router.use("/concepts", conceptRoutes);
router.use("/apartments", apartmentRoutes);
router.use("/users", userRoutes);
router.use("/contracts", contractRoutes);
router.use("/dashboard", dashboardtRoutes);
router.use("/admin", adminRoutes);
router.use("/audit", auditRoutes);

// A futuro cuando crees más módulos, solo los agregas aquí:
// const buildingRoutes = require('./building.routes');
// const paymentRoutes = require('./payment.routes');
// router.use('/buildings', buildingRoutes);
// router.use('/payments', paymentRoutes);

module.exports = router;
