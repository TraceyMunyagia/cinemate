require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");

const MODEL_NAME = "gemini-2.5-flash";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const JSON_GENERATION_CONFIG = { responseMimeType: "application/json" };

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

function isUsingAnthropic() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function generateStructured(prompt) {
  if (isUsingAnthropic()) {
    return generateAnthropic(prompt, {
      maxTokens: 1800,
      temperature: 0.2,
      system: "Return only valid JSON for the requested schema.",
    });
  }

  return generateWithRetry(prompt, 3, { config: JSON_GENERATION_CONFIG });
}

async function generateReply(prompt, systemPrompt) {
  if (isUsingAnthropic()) {
    return generateAnthropic(prompt, {
      maxTokens: 600,
      temperature: 0.7,
      system: systemPrompt,
    });
  }

  return generateWithRetry(prompt);
}

module.exports = { generateStructured, generateReply, isUsingAnthropic };
