const express = require("express");
const router = express.Router();
const billingController = require("../controllers/billing.controller");
const authMiddleware = require("../middlewares/auth.middleware");

router.get(
    "/building/:buildingId/pending-summary",
    authMiddleware.verifyToken,
    billingController.getPendingSummary,
);

router.get(
    "/building/:buildingId/pending-detailed",
    authMiddleware.verifyToken,
    billingController.getPendingDetailed,
);

router.get(
    "/building/:buildingId/expense-periods",
    authMiddleware.verifyToken,
    billingController.getAvailableExpensePeriods,
);
router.get(
    "/building/:buildingId/expenses-by-period",
    authMiddleware.verifyToken,
    billingController.getExpensesByPeriod,
);

// Todas estas rutas requieren ser Administrador de Edificio
router.use(authMiddleware.verifyToken, authMiddleware.isBuildingAdmin);

// POST /api/billing/generate
// Solo el administrador del edificio puede disparar la facturación mensual
router.get("/expenses/:buildingId", billingController.getBuildingExpenses);
router.post("/expenses", billingController.addExpense);
router.post("/generate", billingController.generateMonthlyBilling);

router.delete("/expenses/:buildingId", billingController.deleteExpense);

router.get("/periods/:buildingId", billingController.getClosedPeriods);

// routes/billing.routes.js
router.get(
    "/report/:buildingId",
    authMiddleware.verifyToken,
    billingController.getMonthlyReport,
);

router.get(
    "/statements/:buildingId",
    authMiddleware.verifyToken,
    billingController.getStatements,
);

router.post(
    "/statements/pay",
    authMiddleware.verifyToken,
    billingController.registerAdminPayment,
);

module.exports = router;
