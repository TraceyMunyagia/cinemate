// tests/sessions.js
// Checks the Sessions tab helpers and the summary spoiler check.
// Run from cinemate-extension/:  node tests/sessions.js

const assert = require("assert");

require("../platforms/registry.js");
require("../platforms/youtube.js");
require("../platforms/netflix.js");
require("../utils/sessions.js");
const { sessions } = globalThis.CineMate;

// ---- Spoiler check for saved summaries ----
const memory = { coverage: { endSeconds: 2400 } };
assert.strictEqual(sessions.isMemoryAhead(memory, 600), true, "viewer rewound to 10:00");
assert.strictEqual(sessions.isMemoryAhead(memory, 2380), false, "within the 30s grace");
assert.strictEqual(sessions.isMemoryAhead(memory, null), false, "unknown position");
assert.strictEqual(sessions.isMemoryAhead({}, 600), false, "no coverage info");

// ---- timeAgo ----
const now = 1_000_000_000;
assert.strictEqual(sessions.timeAgo(now - 20_000, now), "just now");
assert.strictEqual(sessions.timeAgo(now - 5 * 60_000, now), "5 min ago");
assert.strictEqual(sessions.timeAgo(now - 3 * 3_600_000, now), "3 h ago");
assert.strictEqual(sessions.timeAgo(now - 26 * 3_600_000, now), "yesterday");
assert.strictEqual(sessions.timeAgo(now - 4 * 86_400_000, now), "4 days ago");

// ---- mergeSessions ----
const merged = sessions.mergeSessions(
  [
    { videoId: "youtube-a", platform: "youtube", title: "", count: 10, updatedAt: 300 },
    { videoId: "netflix-b", platform: "netflix", title: "Show · E1", count: 99, updatedAt: 100 },
    { videoId: "youtube-c", platform: "youtube", title: "Newest", count: 1, updatedAt: 500 },
  ],
  [{ episodeId: "youtube-a", title: "From memory", coveredUntil: "00:20:00", summary: "S" }],
  "netflix-b"
);

assert.deepStrictEqual(merged.map((s) => s.videoId), ["netflix-b", "youtube-c", "youtube-a"]);
assert.strictEqual(merged[0].isActive, true);
assert.strictEqual(merged[0].icon, "🅽");
assert.strictEqual(merged[2].title, "From memory", "title filled from the saved memory");
assert.deepStrictEqual(merged[2].memory, { coveredUntil: "00:20:00", summary: "S" });
assert.strictEqual(merged[1].memory, null);

console.log("✅ Session helpers work");