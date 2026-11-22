// services/aiErrors.js
// Turns the many ways Gemini and Anthropic report problems into a few
// clear errors the panel can act on.

const { HttpError } = require("../utils/validators");

const PROVIDER_LABELS = { gemini: "Gemini", anthropic: "Anthropic" };
const label = (provider) => PROVIDER_LABELS[provider] || "The AI provider";

class AiRateLimitError extends HttpError {
  constructor(provider, retryAfterSeconds, options = {}) {
    const seconds = Math.max(1, Math.ceil(retryAfterSeconds || 30));
    const message = options.daily
      ? `${label(provider)} daily quota is used up. Try again later or switch AI_PROVIDER.`
      : `${label(provider)} rate limit reached. Try again in ${seconds}s.`;

    super(429, message);
    this.code = options.daily ? "AI_DAILY_QUOTA" : "AI_RATE_LIMIT";
    this.retryAfterSeconds = seconds;
  }
}

class AiUnavailableError extends HttpError {
  constructor(provider) {
    super(503, `${label(provider)} is overloaded right now. Try again in a moment.`);
    this.code = "AI_UNAVAILABLE";
    this.retryAfterSeconds = 10;
  }
}

class AiConfigError extends HttpError {
  constructor(provider, detail) {
    super(502, `${label(provider)} rejected the request: ${detail}`);
    this.code = "AI_CONFIG";
  }
}

function getStatus(error) {
  if (Number.isInteger(error.status)) return error.status;
  if (Number.isInteger(error.code)) return error.code;

  const text = String(error.message || "");
  if (/RESOURCE_EXHAUSTED/i.test(text)) return 429;
  if (/\bUNAVAILABLE\b|overloaded/i.test(text)) return 503;

  const match = text.match(/"code"\s*:\s*(\d{3})/);
  return match ? Number(match[1]) : null;
}

// Gemini puts "retryDelay": "37s" inside the error text; Anthropic sends a
// retry-after header (copied onto the error as retryAfterSeconds).
function getRetryAfterMs(error) {
  if (Number.isFinite(error.retryAfterSeconds)) return error.retryAfterSeconds * 1000;

  const text = String(error.message || "");
  const match =
    text.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) ||
    text.match(/retry in (\d+(?:\.\d+)?)\s*s/i);

  return match ? Math.ceil(parseFloat(match[1]) * 1000) : null;
}

// -> { kind: "rate_limit" | "overloaded" | "auth" | "billing" | "other", retryAfterMs, daily }
function classifyAiError(error) {
  const status = getStatus(error);
  const text = String(error.message || "");

  if (status === 429 || /rate limit/i.test(text)) {
    return {
      kind: "rate_limit",
      retryAfterMs: getRetryAfterMs(error),
      daily: /PerDay|per day|daily/i.test(text),
    };
  }

  if (status === 503 || status === 529) {
    return { kind: "overloaded", retryAfterMs: getRetryAfterMs(error), daily: false };
  }

  if (/credit balance/i.test(text)) {
    return { kind: "billing", retryAfterMs: null, daily: false };
  }

  if (status === 401 || status === 403 || /api key not valid|API_KEY_INVALID|invalid x-api-key/i.test(text)) {
    return { kind: "auth", retryAfterMs: null, daily: false };
  }

  return { kind: "other", retryAfterMs: null, daily: false };
}

module.exports = {
  AiRateLimitError,
  AiUnavailableError,
  AiConfigError,
  classifyAiError,
  getRetryAfterMs,
};