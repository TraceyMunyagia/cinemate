// tests/aiService.test.js  –  run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { createAiService } = require("../services/aiService");

function fakeClock() {
  let t = 0;
  return { now: () => t, wait: async (ms) => { t += ms; } };
}

const rateLimited = (seconds) =>
  Object.assign(new Error(`RESOURCE_EXHAUSTED "retryDelay": "${seconds}s"`), { status: 429 });

test("retries a short rate limit and then succeeds", async () => {
  const clock = fakeClock();
  let calls = 0;
  const ai = createAiService({
    provider: "gemini",
    requestsPerMinute: 100,
    ...clock,
    callProvider: async () => {
      calls++;
      if (calls === 1) throw rateLimited(3);
      return "hello";
    },
  });

  assert.strictEqual(await ai.generateReply("hi", "sys", { maxWaitMs: 8000 }), "hello");
  assert.strictEqual(calls, 2);
  assert.strictEqual(clock.now(), 3000);
});

test("gives up fast with a 429 when the provider wants a long wait", async () => {
  const clock = fakeClock();
  const ai = createAiService({
    provider: "gemini",
    requestsPerMinute: 100,
    ...clock,
    callProvider: async () => {
      throw rateLimited(40);
    },
  });

  await assert.rejects(ai.generateReply("hi", "sys", { maxWaitMs: 8000 }), (error) => {
    assert.strictEqual(error.status, 429);
    assert.strictEqual(error.retryAfterSeconds, 40);
    return true;
  });
  assert.strictEqual(clock.now(), 0, "did not sit waiting for 40s");
});

test("turns an invalid key into a clear config error", async () => {
  const ai = createAiService({
    provider: "gemini",
    requestsPerMinute: 100,
    ...fakeClock(),
    callProvider: async () => {
      throw new Error("API key not valid. Please pass a valid API key.");
    },
  });

  await assert.rejects(ai.generateReply("hi"), /API key is invalid/);
});

test("passes other errors straight through", async () => {
  const ai = createAiService({
    provider: "anthropic",
    requestsPerMinute: 100,
    ...fakeClock(),
    callProvider: async () => {
      throw new Error("something else");
    },
  });

  await assert.rejects(ai.generateReply("hi"), /something else/);
});