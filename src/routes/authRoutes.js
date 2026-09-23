const express = require("express");
const { login } = require("../controllers/authController");

const router = express.Router();

router.post("/login", (req, res, next) => login(req, res).catch(next));

module.exports = router;
