const express = require("express");
const { summarize } = require("../controllers/summarizeController");

const router = express.Router();

router.post("/summarize", summarize);

module.exports = router;
