const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/payment.controller");
const authMiddleware = require("../middlewares/auth.middleware");

// POST /api/payments
router.post(
    "/",
    authMiddleware.verifyToken,
    authMiddleware.isOwner,
    paymentController.reportPayment,
);

router.get(
    "/recent",
    authMiddleware.verifyToken,
    authMiddleware.isOwner,
    paymentController.getMyPayments,
);

// GET /api/payments/building-admin
router.get(
    "/building-admin",
    authMiddleware.verifyToken,
    paymentController.getBuildingPayments,
);

// PATCH /api/payments/:id/approve
router.patch(
    "/:id/approve",
    authMiddleware.verifyToken,
    paymentController.approvePayment,
);

module.exports = router;
