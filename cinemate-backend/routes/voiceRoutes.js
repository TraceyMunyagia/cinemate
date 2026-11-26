const express = require("express");
const { status, transcribe, textToSpeech } = require("../controllers/voiceController");

const router = express.Router();

router.get("/voice/status", status);
router.post("/transcribe", express.raw({ type: () => true, limit: "25mb" }), transcribe);
router.post("/tts", textToSpeech);

module.exports = router;