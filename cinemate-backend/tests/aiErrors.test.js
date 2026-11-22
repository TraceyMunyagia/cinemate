// tests/aiErrors.test.js  –  run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { classifyAiError, AiRateLimitError } = require("../services/aiErrors");

test("reads Gemini's retryDelay from a 429", () => {
  const error = Object.assign(
    new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"37s"}]}}'),
    { status: 429 }
  );
  assert.deepStrictEqual(classifyAiError(error), { kind: "rate_limit", retryAfterMs: 37000, daily: false });
});

test("spots Gemini's daily free-tier quota", () => {
  const error = new Error("RESOURCE_EXHAUSTED quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier");
  assert.strictEqual(classifyAiError(error).daily, true);
});

test("uses Anthropic's retry-after header", () => {
  const error = Object.assign(new Error("rate_limit_error"), { status: 429, retryAfterSeconds: 12 });
  assert.strictEqual(classifyAiError(error).retryAfterMs, 12000);
});

test("recognises overload, auth and billing problems", () => {
  assert.strictEqual(classifyAiError(Object.assign(new Error("Overloaded"), { status: 529 })).kind, "overloaded");
  assert.strictEqual(classifyAiError(new Error("API key not valid. Please pass a valid API key.")).kind, "auth");
  assert.strictEqual(
    classifyAiError(new Error("Your credit balance is too low to access the Anthropic API.")).kind,
    "billing"
  );
});

test("rate-limit errors carry a friendly message and retry time", () => {
  const error = new AiRateLimitError("gemini", 36.2);
  assert.strictEqual(error.status, 429);
  assert.strictEqual(error.retryAfterSeconds, 37);
  assert.match(error.message, /Gemini rate limit reached\. Try again in 37s\./);
});