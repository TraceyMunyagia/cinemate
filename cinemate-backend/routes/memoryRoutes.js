const express = require("express");
const { getMemory, listMemories, deleteMemory } = require("../controllers/memoryController");

const router = express.Router();

router.get("/memory", listMemories);
router.get("/memory/:episodeId", getMemory);
router.delete("/memory/:episodeId", deleteMemory);

module.exports = router;