// tests/replay-captions.js
// Replays recorded caption frames through the cleaner and checks the result.
// Run from cinemate-extension/:  node tests/replay-captions.js

const assert = require("assert");

require("../utils/timestamps.js");
require("../utils/subtitleCleaner.js");
const sample = require("../data/sample-subtitles.json");

const { captions } = globalThis.CineMate;
const tracker = captions.createTracker([]);

for (const frame of sample.frames) {
  tracker.push(frame.text, frame.seconds);
}

console.table(tracker.entries.map(({ time, text }) => ({ time, text })));

assert.deepStrictEqual(
  tracker.entries.map((entry) => entry.text),
  sample.expected
);

// Helper checks
assert.strictEqual(captions.normalize("  ♪ Hello   there ♪ "), "Hello there");
assert.strictEqual(captions.countOverlapWords("a b c d", "c d e", 2), 2);
assert.strictEqual(globalThis.CineMate.time.formatTime(3723.9), "01:02:03");
assert.strictEqual(globalThis.CineMate.time.parseTime("01:02:03"), 3723);

console.log("✅ Caption replay matches expected output");