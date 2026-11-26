// tests/health.test.js  –  run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { health } = require("../controllers/healthController");

test("reports the service, provider and whether a key is set – never the key", () => {
  let body;
  health({}, { json: (data) => (body = data) });

  assert.strictEqual(body.success, true);
  assert.strictEqual(body.service, "cinemate-backend");
  assert.ok(["gemini", "anthropic"].includes(body.ai.provider));
  assert.strictEqual(typeof body.ai.keySet, "boolean");
  assert.ok(!JSON.stringify(body).includes(process.env.GEMINI_API_KEY || "no-key-here"), "no key leaked");
});