const express = require("express");
const router = express.Router();
const contractController = require("../controllers/contract.controller");
const authMiddleware = require("../middlewares/auth.middleware");

router.use(authMiddleware.verifyToken, authMiddleware.isBuildingAdmin);

router.get("/:buildingId", contractController.getContracts);
router.post("/", contractController.createContract);

module.exports = router;
