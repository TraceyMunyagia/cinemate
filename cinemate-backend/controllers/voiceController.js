const fs = require("fs");
const voiceService = require("../services/voiceService");
const { requireAudioBuffer, requireText } = require("../utils/validators");

const USE_MOCK_AI = process.env.USE_MOCK_AI === "true";

async function transcribe(req, res, next) {
  try {
    requireAudioBuffer(req.body);

    if (USE_MOCK_AI) {
      return res.json({
        success: true,
        mock: true,
        transcript: "What is happening in this scene?",
      });
    }

    const { provider, transcript } = await voiceService.transcribeAudio(
      req.body,
      req.headers["content-type"] || "audio/webm"
    );

    res.json({ success: true, provider, transcript });
  } catch (error) {
    next(error);
  }
}

async function textToSpeech(req, res, next) {
  let audioPath;

  try {
    const { text } = req.body;
    requireText(text);

    if (USE_MOCK_AI) {
      return res.status(204).send();
    }

    const audio = await voiceService.synthesizeSpeech(text.trim());
    audioPath = audio.path;

    res.setHeader("Content-Type", audio.contentType);
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(audioPath, (error) => {
      fs.promises.unlink(audioPath).catch(() => {});

      if (error) {
        console.error("Error sending TTS audio:", error.message);
      }
    });
  } catch (error) {
    if (audioPath) {
      fs.promises.unlink(audioPath).catch(() => {});
    }

    next(error);
  }
}

module.exports = { transcribe, textToSpeech };
