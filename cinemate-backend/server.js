require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { GoogleGenAI } = require("@google/genai");
const OpenAI = require("openai");
const { toFile } = require("openai");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const app = express();
app.use(cors());
app.use(express.json());

const MODEL_NAME = "gemini-2.5-flash";
const JSON_GENERATION_CONFIG = {
  responseMimeType: "application/json",
};

const MAX_CHARS = 8000;
const CHUNK_MAX_CHARS = 1200;
const USE_MOCK_AI = process.env.USE_MOCK_AI === "true";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const USE_LOCAL_WHISPER = process.env.USE_LOCAL_WHISPER !== "false";
const USE_LOCAL_TTS = process.env.USE_LOCAL_TTS !== "false";
const LOCAL_VOICE_PYTHON = "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3";
const PYTHON_BIN = process.env.PYTHON_BIN ||
  (fs.existsSync(LOCAL_VOICE_PYTHON) ? LOCAL_VOICE_PYTHON : "python3");
const SCRIPTS_DIR = path.join(__dirname, "scripts");
let openaiClient = null;
let genAIClient = null;

function getGeminiClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required for Gemini responses.");
  }

  if (!genAIClient) {
    genAIClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  return genAIClient;
}

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

function buildSubtitleChunks(subtitles) {
  const chunks = [];
  let currentEntries = [];
  let currentText = "";
  let totalChars = 0;

  for (const subtitle of subtitles) {
    const text = String(subtitle.text || "").trim();
    if (!text) continue;

    const entryText = `[${subtitle.time || "00:00:00"}] ${text}`;

    if (totalChars + entryText.length > MAX_CHARS) break;

    if (currentText && currentText.length + entryText.length + 1 > CHUNK_MAX_CHARS) {
      chunks.push({
        index: chunks.length,
        startTime: currentEntries[0]?.time || "00:00:00",
        endTime: currentEntries[currentEntries.length - 1]?.time || "00:00:00",
        entryCount: currentEntries.length,
        text: currentText,
      });

      currentEntries = [];
      currentText = "";
    }

    currentEntries.push(subtitle);
    currentText = currentText ? `${currentText}\n${entryText}` : entryText;
    totalChars += entryText.length;
  }

  if (currentEntries.length > 0) {
    chunks.push({
      index: chunks.length,
      startTime: currentEntries[0]?.time || "00:00:00",
      endTime: currentEntries[currentEntries.length - 1]?.time || "00:00:00",
      entryCount: currentEntries.length,
      text: currentText,
    });
  }

  return chunks;
}

function extractJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Gemini response did not contain a JSON object.");
    }

    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function normalizeEpisodeMemory(memory, chunks) {
  return {
    summary: String(memory.summary || ""),
    characters: Array.isArray(memory.characters) ? memory.characters : [],
    importantEvents: Array.isArray(memory.importantEvents)
      ? memory.importantEvents
      : [],
    keyThemes: Array.isArray(memory.keyThemes) ? memory.keyThemes : [],
    emotionalMoments: Array.isArray(memory.emotionalMoments)
      ? memory.emotionalMoments
      : [],
    majorConflicts: Array.isArray(memory.majorConflicts)
      ? memory.majorConflicts
      : [],
    importantCharacterActions: Array.isArray(memory.importantCharacterActions)
      ? memory.importantCharacterActions
      : [],
    subtitleChunks: chunks.map(({ text, ...chunk }) => ({
      ...chunk,
      summary: memory.subtitleChunks?.[chunk.index]?.summary || "",
    })),
  };
}

function buildMockEpisodeMemory(subtitles, chunks) {
  const sampleLines = subtitles.slice(-5).map((s) => s.text).filter(Boolean);
  const summary =
    sampleLines.length > 0
      ? `Mock summary generated from ${subtitles.length} captured subtitle entries. Recent dialogue: ${sampleLines.join(" ")}`
      : "Mock summary generated without subtitle text.";

  return {
    summary,
    characters: [],
    importantEvents: [
      {
        time: subtitles[0]?.time || "00:00:00",
        description: "Mock event based on captured subtitle flow.",
      },
    ],
    keyThemes: ["Mock theme"],
    emotionalMoments: [],
    majorConflicts: [],
    importantCharacterActions: [],
    subtitleChunks: chunks.map(({ text, ...chunk }) => ({
      ...chunk,
      summary: "Mock chunk summary.",
    })),
  };
}

async function generateWithRetry(prompt, retries = 3, options = {}) {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await getGeminiClient().models.generateContent({
        model: options.model || MODEL_NAME,
        contents: prompt,
        config: options.config,
      });
      return result.text || "";
    } catch (err) {
      const isRateLimit =
        err.message.includes("429") || err.message.includes("RetryInfo");

      if (isRateLimit && i < retries - 1) {
        const wait = (i + 1) * 30000; // 30s, then 60s
        console.warn(`Rate limited. Retrying in ${wait / 1000}s... (attempt ${i + 1}/${retries})`);
        await new Promise((res) => setTimeout(res, wait));
      } else {
        throw err;
      }
    }
  }
}

function getAnthropicText(response) {
  return (response.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

async function generateAnthropic(prompt, options = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required for Anthropic responses.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: options.maxTokens || 1000,
      temperature: options.temperature ?? 0.4,
      system: options.system,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "Anthropic request failed.");
  }

  return getAnthropicText(data);
}

// ── /transcribe ───────────────────────────────────────────────────────────────
app.post(
  "/transcribe",
  express.raw({ type: () => true, limit: "25mb" }),
  async (req, res) => {
    try {
      if (!req.body || req.body.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Missing audio body.",
        });
      }

      if (USE_MOCK_AI) {
        return res.json({
          success: true,
          mock: true,
          transcript: "What is happening in this scene?",
        });
      }

      if (USE_LOCAL_WHISPER) {
        const transcript = await transcribeWithLocalWhisper(
          req.body,
          req.headers["content-type"] || "audio/webm"
        );

        return res.json({
          success: true,
          provider: "local-whisper",
          transcript,
        });
      }

      const file = await toFile(
        req.body,
        "voice.webm",
        { type: req.headers["content-type"] || "audio/webm" }
      );

      const transcription = await getOpenAIClient().audio.transcriptions.create({
        file,
        model: "whisper-1",
      });

      res.json({
        success: true,
        transcript: transcription.text || "",
      });
    } catch (error) {
      console.error("Error in /transcribe:", error.message);

      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// ── /tts ─────────────────────────────────────────────────────────────────────
app.post("/tts", async (req, res) => {
  let audioPath;

  try {
    const { text } = req.body;

    if (!text || typeof text !== "string" || text.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "Invalid or missing text.",
      });
    }

    if (USE_MOCK_AI) {
      return res.status(204).send();
    }

    if (!USE_LOCAL_TTS) {
      return res.status(400).json({
        success: false,
        error: "Local TTS is disabled.",
      });
    }

    const audio = await synthesizeWithLocalTts(text.trim());
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

    console.error("Error in /tts:", error.message);

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ── /summarize ────────────────────────────────────────────────────────────────
app.post("/summarize", async (req, res) => {
  try {
    const { subtitles } = req.body;

    if (!subtitles || !Array.isArray(subtitles) || subtitles.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid or missing subtitles. Expected a non-empty array.",
      });
    }

    const subtitleChunks = buildSubtitleChunks(subtitles);

    if (subtitleChunks.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No usable subtitle text found.",
      });
    }

    if (USE_MOCK_AI) {
      const episodeMemory = buildMockEpisodeMemory(subtitles, subtitleChunks);
      return res.json({
        success: true,
        mock: true,
        summary: episodeMemory.summary,
        episodeMemory,
      });
    }

    const prompt = `
You are CineMate, an AI TV episode memory builder.

Convert the subtitle chunks into a structured episode memory.

Return ONLY valid JSON. Do not include markdown, backticks, comments, or prose outside the JSON.

The JSON object must have this exact shape:
{
  "summary": "Concise episode summary in 3-6 sentences.",
  "characters": [
    {
      "name": "Character name or unknown label",
      "description": "What can be inferred from the subtitles.",
      "emotionalState": "Brief emotional state if clear from dialogue.",
      "goals": ["Goal or motivation if clear."]
    }
  ],
  "importantEvents": [
    {
      "time": "HH:MM:SS if available",
      "description": "Important event from the subtitles.",
      "whyItMatters": "Why this event matters."
    }
  ],
  "keyThemes": ["Theme"],
  "emotionalMoments": [
    {
      "time": "HH:MM:SS if available",
      "description": "Emotionally important moment.",
      "emotion": "Primary emotion."
    }
  ],
  "majorConflicts": [
    {
      "description": "Conflict description.",
      "charactersInvolved": ["Character name"],
      "status": "resolved, unresolved, or unclear"
    }
  ],
  "importantCharacterActions": [
    {
      "character": "Character name or unknown label",
      "action": "Important action or decision.",
      "impact": "Impact on the episode."
    }
  ],
  "subtitleChunks": [
    {
      "index": 0,
      "summary": "Short summary of this chunk."
    }
  ]
}

Use empty arrays when information is not available. Do not invent names if the subtitles do not reveal them.

Subtitle chunks:
${JSON.stringify(subtitleChunks, null, 2)}
`;

    const rawMemory = process.env.ANTHROPIC_API_KEY
      ? await generateAnthropic(prompt, {
          maxTokens: 1800,
          temperature: 0.2,
          system: "Return only valid JSON for the requested schema.",
        })
      : await generateWithRetry(prompt, 3, {
          config: JSON_GENERATION_CONFIG,
        });

    const episodeMemory = normalizeEpisodeMemory(
      extractJson(rawMemory),
      subtitleChunks
    );

    res.json({
      success: true,
      summary: episodeMemory.summary,
      episodeMemory,
    });
  } catch (error) {
    console.error("Error in /summarize:", error.message);

    const isRateLimit =
      error.message.includes("429") || error.message.includes("RetryInfo");

    res.status(isRateLimit ? 429 : 500).json({
      success: false,
      error: isRateLimit
        ? "Rate limit hit. Please wait a moment and try again."
        : error.message,
    });
  }
});

// ── /chat ─────────────────────────────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  try {
    const { subtitles, message } = req.body;

    if (!message || typeof message !== "string" || message.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "Invalid or missing message.",
      });
    }

    if (subtitles && !Array.isArray(subtitles)) {
      return res.status(400).json({
        success: false,
        error: "Invalid subtitles. Expected an array.",
      });
    }

    const subtitleText = (subtitles || [])
      .slice(-5)
      .map((s) => s.text)
      .join(" ");

    if (USE_MOCK_AI) {
      return res.json({
        success: true,
        mock: true,
        reply: `Mock reply to: "${message}". I can discuss the scene using the captured subtitle context.`,
      });
    }

    const prompt = `
You are CineMate, an emotionally intelligent AI movie companion.
The user just watched an episode.
Recent episode dialogue, if available:
${subtitleText || "No subtitles are available yet."}
User says:
"${message}"
Respond naturally like a thoughtful friend who actually watched the episode.
`;

    const usingAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
    const reply = usingAnthropic
      ? await generateAnthropic(prompt, {
          maxTokens: 600,
          temperature: 0.7,
          system: "You are CineMate, an emotionally intelligent AI movie companion. Keep replies natural, concise, and grounded in the available subtitles.",
        })
      : await generateWithRetry(prompt);

    res.json({
      success: true,
      provider: usingAnthropic ? "anthropic" : "gemini",
      reply,
    });
  } catch (error) {
    console.error("Error in /chat:", error.message);

    const isRateLimit =
      error.message.includes("429") || error.message.includes("RetryInfo");

    res.status(isRateLimit ? 429 : 500).json({
      success: false,
      error: isRateLimit
        ? "Rate limit hit. Please wait a moment and try again."
        : error.message,
    });
  }
});

app.listen(3000, () => {
  console.log("🚀 Gemini server running on port 3000");
});
