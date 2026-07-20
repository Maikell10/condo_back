const express = require("express");
const router = express.Router();
const tasaCambioController = require("../controllers/tasaCambio.controller");

router.get("/tasa", tasaCambioController.setTasaBCV);

module.exports = router;
