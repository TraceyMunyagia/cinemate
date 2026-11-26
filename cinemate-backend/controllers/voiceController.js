const fs = require("fs");
const config = require("../config");
const voiceService = require("../services/voiceService");
const { requireAudioBuffer, requireText } = require("../utils/validators");

// GET /voice/status  (?refresh=1 to re-check instead of using the 60s cache)
async function status(req, res, next) {
  try {
    if (config.useMockAi) {
      return res.json({
        success: true,
        mock: true,
        transcription: { provider: "mock", available: true, problem: null },
        speech: { provider: "browser", available: false, problem: "Mock mode uses the browser's voice." },
      });
    }

    const result = await voiceService.getStatus({ refresh: req.query.refresh === "1" });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

// POST /transcribe  (raw audio body) – only used when voice input is set to "server"
async function transcribe(req, res, next) {
  try {
    requireAudioBuffer(req.body);

    if (config.useMockAi) {
      return res.json({ success: true, mock: true, transcript: "What is happening in this scene?" });
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

// POST /tts { text } – only used when voice output is set to "server".
// 204 = "use the browser's voice instead".
async function textToSpeech(req, res, next) {
  let audioPath;

  try {
    const { text } = req.body;
    requireText(text);

    if (config.useMockAi) {
      return res.status(204).send();
    }

    const audio = await voiceService.synthesizeSpeech(text.trim());
    audioPath = audio.path;

    res.setHeader("Content-Type", audio.contentType);
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(audioPath, (error) => {
      fs.promises.unlink(audioPath).catch(() => {});
      if (error) console.error("Error sending TTS audio:", error.message);
    });
  } catch (error) {
    if (audioPath) fs.promises.unlink(audioPath).catch(() => {});
    next(error);
  }
}

module.exports = { status, transcribe, textToSpeech };