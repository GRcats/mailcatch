const express = require("express");
const router = express.Router();
const { authRateLimit } = require("../../middleware/rateLimit");

const {
    login
} = require("../controllers/authController");


router.post("/login", authRateLimit, login);

module.exports = router;
