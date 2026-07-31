const express = require("express");
const { getMemory, listMemories } = require("../controllers/memoryController");

const router = express.Router();

router.get("/memory", listMemories);
router.get("/memory/:episodeId", getMemory);

module.exports = router;
