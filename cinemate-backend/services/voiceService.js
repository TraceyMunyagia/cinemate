const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const OpenAI = require("openai");
const { toFile } = require("openai");
const { HttpError } = require("../utils/validators");

const USE_LOCAL_WHISPER = process.env.USE_LOCAL_WHISPER !== "false";
const USE_LOCAL_TTS = process.env.USE_LOCAL_TTS !== "false";
const LOCAL_VOICE_PYTHON = "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3";
const PYTHON_BIN = process.env.PYTHON_BIN ||
  (fs.existsSync(LOCAL_VOICE_PYTHON) ? LOCAL_VOICE_PYTHON : "python3");
const SCRIPTS_DIR = path.join(__dirname, "..", "scripts");

let openaiClient = null;

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for Whisper transcription.");
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  return openaiClient;
}

function runPythonScript(scriptName, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [path.join(SCRIPTS_DIR, scriptName), ...args], {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${scriptName} timed out.`));
    }, options.timeoutMs || 120000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        reject(new Error(stderr.trim() || `${scriptName} exited with code ${code}.`));
        return;
      }

      resolve(stdout.trim());
    });
  });
}

async function transcribeWithLocalWhisper(audioBuffer, contentType) {
  const extension = contentType.includes("mp4") ? "mp4" : "webm";
  const audioPath = path.join(os.tmpdir(), `cinemate-voice-${Date.now()}.${extension}`);

  await fs.promises.writeFile(audioPath, audioBuffer);

  try {
    const output = await runPythonScript("transcribe.py", [audioPath], {
      timeoutMs: 180000,
    });
    const result = JSON.parse(output);

    if (!result.success) {
      throw new Error(result.error || "Local Whisper transcription failed.");
    }

    return result.transcript || "";
  } finally {
    fs.promises.unlink(audioPath).catch(() => {});
  }
}

async function transcribeWithOpenAI(audioBuffer, contentType) {
  const file = await toFile(audioBuffer, "voice.webm", { type: contentType });

  const transcription = await getOpenAIClient().audio.transcriptions.create({
    file,
    model: "whisper-1",
  });

  return transcription.text || "";
}

async function transcribeAudio(audioBuffer, contentType) {
  if (USE_LOCAL_WHISPER) {
    return {
      provider: "local-whisper",
      transcript: await transcribeWithLocalWhisper(audioBuffer, contentType),
    };
  }

  return {
    provider: "openai",
    transcript: await transcribeWithOpenAI(audioBuffer, contentType),
  };
}

async function synthesizeWithLocalTts(text) {
  const outputPath = path.join(os.tmpdir(), `cinemate-tts-${Date.now()}.wav`);

  try {
    const output = await runPythonScript("tts.py", [text, outputPath], {
      timeoutMs: 60000,
    });
    const result = JSON.parse(output);

    if (!result.success) {
      throw new Error(result.error || "Local TTS failed.");
    }

    return {
      path: outputPath,
      contentType: "audio/wav",
    };
  } catch (error) {
    fs.promises.unlink(outputPath).catch(() => {});
    throw error;
  }
}

async function synthesizeSpeech(text) {
  if (!USE_LOCAL_TTS) {
    throw new HttpError(400, "Local TTS is disabled.");
  }

  return synthesizeWithLocalTts(text);
}

module.exports = { transcribeAudio, synthesizeSpeech };
