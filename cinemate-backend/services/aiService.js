// services/aiService.js
// The only file that talks to Gemini or Anthropic. Picks the provider from
// AI_PROVIDER, keeps requests under the per-minute limit, retries short
// rate-limit/overload errors and turns long ones into a clear 429.
// (Replaces services/geminiService.js.)

const { GoogleGenAI } = require("@google/genai");
const config = require("../config");
const { createRateLimiter } = require("./rateLimiter");
const {
  AiRateLimitError,
  AiUnavailableError,
  AiConfigError,
  classifyAiError,
} = require("./aiErrors");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Provider calls ----------

let geminiClient = null;

async function callGemini({ prompt, system, json, temperature }) {
  if (!config.gemini.apiKey) {
    throw new AiConfigError("gemini", "GEMINI_API_KEY is missing in cinemate-backend/.env.");
  }

  geminiClient = geminiClient || new GoogleGenAI({ apiKey: config.gemini.apiKey });

  const result = await geminiClient.models.generateContent({
    model: config.gemini.model,
    contents: prompt,
    config: {
      ...(system ? { systemInstruction: system } : {}),
      ...(json ? { responseMimeType: "application/json" } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    },
  });

  return result.text || "";
}

async function callAnthropic({ prompt, system, maxTokens, temperature }) {
  if (!config.anthropic.apiKey) {
    throw new AiConfigError("anthropic", "ANTHROPIC_API_KEY is missing in cinemate-backend/.env.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.anthropic.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.anthropic.model,
      max_tokens: maxTokens || 1000,
      temperature: temperature ?? 0.4,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error?.message || `Anthropic request failed (${response.status}).`);
    error.status = response.status;
    const retryAfter = Number(response.headers.get("retry-after"));
    if (Number.isFinite(retryAfter)) error.retryAfterSeconds = retryAfter;
    throw error;
  }

  return (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

const PROVIDER_CALLS = { gemini: callGemini, anthropic: callAnthropic };

// ---------- Retry + rate-limit wrapper ----------

// Built as a factory so tests can swap in a fake provider and clock.
function createAiService({
  provider = config.aiProvider,
  callProvider = (request) => PROVIDER_CALLS[provider](request),
  requestsPerMinute = config[provider].requestsPerMinute,
  maxRetries = config.ai.maxRetries,
  now = Date.now,
  wait = sleep,
} = {}) {
  const limiter = createRateLimiter({ requestsPerMinute, now, sleep: wait });

  async function generate(request, maxWaitMs) {
    const deadline = now() + maxWaitMs;

    for (let attempt = 0; ; attempt++) {
      await limiter.acquire(
        Math.max(0, deadline - now()),
        (delayMs) => new AiRateLimitError(provider, delayMs / 1000)
      );

      try {
        return await callProvider(request);
      } catch (error) {
        if (error.code === "AI_CONFIG") throw error;

        const info = classifyAiError(error);

        if (info.kind === "auth") {
          throw new AiConfigError(provider, "the API key is invalid. Check cinemate-backend/.env.");
        }
        if (info.kind === "billing") {
          throw new AiConfigError(provider, "the account is out of credits.");
        }
        if (info.kind !== "rate_limit" && info.kind !== "overloaded") throw error;

        // Exponential backoff (1s, 2s, 4s...) unless the provider told us how long.
        const delayMs = info.retryAfterMs ?? 1000 * 2 ** attempt;
        if (info.kind === "rate_limit") limiter.pauseFor(delayMs);

        const canRetry =
          !info.daily && attempt < maxRetries && now() + delayMs <= deadline;

        if (!canRetry) {
          if (info.kind === "overloaded") throw new AiUnavailableError(provider);
          throw new AiRateLimitError(provider, delayMs / 1000, { daily: info.daily });
        }

        console.warn(`${provider} ${info.kind}: retrying in ${Math.round(delayMs / 1000)}s`);
        await wait(delayMs);
      }
    }
  }

  // Conversational reply.
  function generateReply(prompt, system, options = {}) {
    return generate(
      { prompt, system, temperature: 0.7, maxTokens: 600 },
      options.maxWaitMs ?? config.ai.chatMaxWaitMs
    );
  }

  // JSON output (episode memory).
  function generateStructured(prompt, options = {}) {
    return generate(
      {
        prompt,
        system: "Return only valid JSON for the requested schema.",
        json: true,
        temperature: 0.2,
        maxTokens: 2500,
      },
      options.maxWaitMs ?? config.ai.summaryMaxWaitMs
    );
  }

  return { generateReply, generateStructured, getProviderName: () => provider };
}

module.exports = { ...createAiService(), createAiService };