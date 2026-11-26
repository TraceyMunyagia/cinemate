// tests/status.js
// Checks which banner the panel shows.
// Run from cinemate-extension/:  node tests/status.js

const assert = require("assert");

require("../utils/status.js");
const { status } = globalThis.CineMate;

const realKey = { ai: { provider: "gemini", mock: false, keySet: true } };

assert.strictEqual(status.describeProblem({ server: "ok", health: realKey, tab: "ok", captions: "ok" }), null, "all good");

const offline = status.describeProblem({ server: "offline", backendUrl: "http://localhost:3000", tab: "unreachable" });
assert.strictEqual(offline.level, "error");
assert.strictEqual(offline.action, "retry");
assert.match(offline.text, /offline \(http:\/\/localhost:3000\)/);

const tab = status.describeProblem({ server: "ok", health: realKey, tab: "unreachable", captions: "missing" });
assert.strictEqual(tab.action, "refresh", "tab problem beats captions");

const captions = status.describeProblem({ server: "ok", health: realKey, tab: "ok", captions: "missing", platformLabel: "Netflix" });
assert.match(captions.text, /turn on subtitles \(CC\) in the Netflix player/);

assert.strictEqual(
  status.describeProblem({ server: "ok", health: realKey, tab: "ok", captions: "waiting" }),
  null,
  "no warning in the first seconds"
);

const noKey = status.describeProblem({ server: "ok", health: { ai: { provider: "gemini", mock: false, keySet: false } } });
assert.match(noKey.text, /No API key for gemini/);

const mock = status.describeProblem({ server: "ok", health: { ai: { provider: "gemini", mock: true, keySet: false } } });
assert.strictEqual(mock.level, "info");

console.log("✅ Status banner works");