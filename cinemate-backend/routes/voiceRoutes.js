const express = require("express");
const { transcribe, textToSpeech } = require("../controllers/voiceController");

const router = express.Router();

router.post("/transcribe", express.raw({ type: () => true, limit: "25mb" }), transcribe);
router.post("/tts", textToSpeech);

module.exports = router;
