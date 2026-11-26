// config.js
// Every setting the backend reads from .env, in one place.

require("dotenv").config();

const PROVIDERS = ["gemini", "anthropic"];

function readBool(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return value.trim().toLowerCase() === "true";
}

function readNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const aiProvider = (process.env.AI_PROVIDER || "gemini").trim().toLowerCase();

if (!PROVIDERS.includes(aiProvider)) {
  throw new Error(`AI_PROVIDER must be one of: ${PROVIDERS.join(", ")} (got "${aiProvider}").`);
}

const config = {
  port: readNumber("PORT", 3000),
  aiProvider,
  useMockAi: readBool("USE_MOCK_AI", false),

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    requestsPerMinute: readNumber("GEMINI_RPM", 10),
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    requestsPerMinute: readNumber("ANTHROPIC_RPM", 50),
  },

  // How long one request may wait (rate-limit queue + retries) before
  // CineMate gives up and tells the panel to try again later.
    ai: {
    maxRetries: readNumber("AI_MAX_RETRIES", 2),
    chatMaxWaitMs: readNumber("AI_CHAT_MAX_WAIT_MS", 8000),
    summaryMaxWaitMs: readNumber("AI_SUMMARY_MAX_WAIT_MS", 45000),
  },

  // Server-side voice is optional: the panel uses the browser's own speech
  // recognition and voice by default, and only calls these when asked to.
  voice: {
    useLocalWhisper: readBool("USE_LOCAL_WHISPER", true),
    useLocalTts: readBool("USE_LOCAL_TTS", true),
    whisperModel: process.env.WHISPER_MODEL || "tiny",
    pythonBin: process.env.PYTHON_BIN || "python3",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
  },
};

// Startup warnings, so a missing key shows up before the first request.
function describeConfig() {
  if (config.useMockAi) return "AI: mock mode (USE_MOCK_AI=true)";

  const settings = config[config.aiProvider];
  const keyName = `${config.aiProvider.toUpperCase()}_API_KEY`;
  const keyStatus = settings.apiKey ? "key set" : `⚠️  ${keyName} is missing`;

  return `AI: ${config.aiProvider} (${settings.model}, ${settings.requestsPerMinute} req/min, ${keyStatus})`;
}

module.exports = { ...config, PROVIDERS, describeConfig };