// services/voiceService.js
// Optional server-side voice: local Whisper (or OpenAI Whisper) for
// speech-to-text and pyttsx3 for text-to-speech. The panel uses the
// browser's own speech features by default and only calls these when the
// voice settings say "server".
//
// No machine-specific paths: Python comes from PYTHON_BIN (default "python3").

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const OpenAI = require("openai");
const { toFile } = require("openai");
const config = require("../config");
const { HttpError } = require("../utils/validators");

const SCRIPTS_DIR = path.join(__dirname, "..", "scripts");
const STATUS_CACHE_MS = 60000;

class VoiceUnavailableError extends HttpError {
  constructor(message) {
    super(503, message);
    this.code = "VOICE_UNAVAILABLE";
  }
}

// Runs a program and resolves with its stdout. Rejects with the spawn error
// (e.g. code "ENOENT" when the program isn't installed) or a non-zero exit.
function runCommand(command, args, { timeoutMs = 120000, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, PYTHONUNBUFFERED: "1", ...env },
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(command)} timed out.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const error = new Error(stderr.trim() || `${path.basename(command)} exited with code ${code}.`);
        error.stdout = stdout.trim();
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function createVoiceService({ voice = config.voice, run = runCommand, now = Date.now } = {}) {
  const installHint = `${voice.pythonBin} -m pip install -r requirements-local-voice.txt`;
  const pythonMissing =
    `Python wasn't found at "${voice.pythonBin}". Set PYTHON_BIN in cinemate-backend/.env ` +
    "to the Python that has the voice packages.";

  let statusCache = null;

  const succeeds = (promise) => promise.then(() => true, () => false);

  // ---------- Status (what server voice can do on this machine) ----------

  async function getStatus({ refresh = false } = {}) {
    if (!refresh && statusCache && now() - statusCache.at < STATUS_CACHE_MS) {
      return statusCache.status;
    }

    const python = await succeeds(run(voice.pythonBin, ["--version"], { timeoutMs: 10000 }));
    const ffmpeg = await succeeds(run("ffmpeg", ["-version"], { timeoutMs: 10000 }));
    const hasModule = (name) =>
      python ? succeeds(run(voice.pythonBin, ["-c", `import ${name}`], { timeoutMs: 30000 })) : false;

    const whisper = voice.useLocalWhisper ? await hasModule("whisper") : false;
    const pyttsx3 = voice.useLocalTts ? await hasModule("pyttsx3") : false;

    const transcription = voice.useLocalWhisper
      ? {
          provider: "local-whisper",
          available: python && whisper && ffmpeg,
          problem: !python
            ? pythonMissing
            : !whisper
              ? `openai-whisper isn't installed. Run: ${installHint}`
              : !ffmpeg
                ? "ffmpeg isn't installed (macOS: brew install ffmpeg)."
                : null,
        }
      : {
          provider: "openai",
          available: Boolean(voice.openaiApiKey),
          problem: voice.openaiApiKey ? null : "OPENAI_API_KEY is missing in cinemate-backend/.env.",
        };

    const speech = voice.useLocalTts
      ? {
          provider: "pyttsx3",
          available: python && pyttsx3 && ffmpeg,
          problem: !python
            ? pythonMissing
            : !pyttsx3
              ? `pyttsx3 isn't installed. Run: ${installHint}`
              : !ffmpeg
                ? "ffmpeg isn't installed (macOS: brew install ffmpeg)."
                : null,
        }
      : { provider: "pyttsx3", available: false, problem: "Server voice is turned off (USE_LOCAL_TTS=false)." };

    const status = { pythonBin: voice.pythonBin, transcription, speech };
    statusCache = { at: now(), status };
    return status;
  }

  // ---------- Python scripts ----------

  async function runPythonScript(scriptName, args, timeoutMs) {
    let output;

    try {
      output = await run(voice.pythonBin, [path.join(SCRIPTS_DIR, scriptName), ...args], {
        timeoutMs,
        env: { WHISPER_MODEL: voice.whisperModel },
      });
    } catch (error) {
      if (error.code === "ENOENT") throw new VoiceUnavailableError(pythonMissing);
      output = error.stdout; // the scripts print a JSON error before exiting with 1
      if (!output) throw error;
    }

    let result;
    try {
      result = JSON.parse(output);
    } catch {
      throw new Error(`${scriptName} returned something that isn't JSON.`);
    }

    if (!result.success) {
      const message = String(result.error || `${scriptName} failed.`);
      if (/No module named/i.test(message)) {
        throw new VoiceUnavailableError(`${message}. Run: ${installHint}`);
      }
      throw new Error(message);
    }

    return result;
  }

  // ---------- Speech-to-text ----------

  async function transcribeWithLocalWhisper(audioBuffer, contentType) {
    const extension = contentType.includes("mp4") ? "mp4" : "webm";
    const audioPath = path.join(os.tmpdir(), `cinemate-voice-${Date.now()}.${extension}`);

    await fs.promises.writeFile(audioPath, audioBuffer);

    try {
      const result = await runPythonScript("transcribe.py", [audioPath], 180000);
      return result.transcript || "";
    } finally {
      fs.promises.unlink(audioPath).catch(() => {});
    }
  }

  let openaiClient = null;

  async function transcribeWithOpenAI(audioBuffer, contentType) {
    if (!voice.openaiApiKey) {
      throw new VoiceUnavailableError("OPENAI_API_KEY is missing in cinemate-backend/.env.");
    }

    openaiClient = openaiClient || new OpenAI({ apiKey: voice.openaiApiKey });
    const file = await toFile(audioBuffer, "voice.webm", { type: contentType });
    const transcription = await openaiClient.audio.transcriptions.create({ file, model: "whisper-1" });

    return transcription.text || "";
  }

  async function transcribeAudio(audioBuffer, contentType) {
    if (voice.useLocalWhisper) {
      return {
        provider: "local-whisper",
        transcript: await transcribeWithLocalWhisper(audioBuffer, contentType),
      };
    }

    return { provider: "openai", transcript: await transcribeWithOpenAI(audioBuffer, contentType) };
  }

  // ---------- Text-to-speech ----------

  async function synthesizeSpeech(text) {
    if (!voice.useLocalTts) {
      throw new VoiceUnavailableError(
        "Server voice is turned off (USE_LOCAL_TTS=false) – the panel uses the browser's voice instead."
      );
    }

    const outputPath = path.join(os.tmpdir(), `cinemate-tts-${Date.now()}.wav`);

    try {
      await runPythonScript("tts.py", [text, outputPath], 60000);
      return { path: outputPath, contentType: "audio/wav" };
    } catch (error) {
      fs.promises.unlink(outputPath).catch(() => {});
      throw error;
    }
  }

  return { getStatus, transcribeAudio, synthesizeSpeech };
}

module.exports = { ...createVoiceService(), createVoiceService, runCommand, VoiceUnavailableError };