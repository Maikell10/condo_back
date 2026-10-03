const express = require("express");
const router = express.Router();
const vcardController = require("../controllers/vcard.controller");
const authMiddleware = require("../middlewares/auth.middleware");

router.get("/public/:id", vcardController.getPublicVcard);

router.get(
    "/",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    vcardController.listVcards,
);
router.post(
    "/",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    vcardController.createVcard,
);
router.put(
    "/:id",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    vcardController.updateVcard,
);
router.delete(
    "/:id",
    authMiddleware.verifyToken,
    authMiddleware.isSuperAdmin,
    vcardController.deleteVcard,
);

module.exports = router;
