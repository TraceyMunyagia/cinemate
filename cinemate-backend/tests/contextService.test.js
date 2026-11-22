// tests/contextService.test.js  –  run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const context = require("../services/contextService");
const { secondsToTime } = require("../utils/formatter");

// One line every 10 seconds for 20 minutes.
const subtitles = Array.from({ length: 120 }, (_, i) => ({
  time: secondsToTime(i * 10),
  seconds: i * 10,
  text: `Line ${i}`,
}));

test("upTo hides everything after the viewer's position", () => {
  const visible = context.upTo(subtitles, 300);
  assert.strictEqual(visible[visible.length - 1].text, "Line 30");
  assert.strictEqual(context.upTo(subtitles, undefined).length, 120);
});

test("recentDialogue returns the last 3 minutes before the viewer's position", () => {
  const recent = context.recentDialogue(subtitles, 600);
  assert.strictEqual(recent[0].text, "Line 42"); // 420s = 600 - 180
  assert.strictEqual(recent[recent.length - 1].text, "Line 60");
});

test("recentDialogue still gives a few lines in a quiet scene", () => {
  const sparse = [
    { time: "00:01:00", seconds: 60, text: "A" },
    { time: "00:05:00", seconds: 300, text: "B" },
    { time: "00:20:00", seconds: 1200, text: "C" },
  ];
  assert.deepStrictEqual(context.recentDialogue(sparse, 1300).map((e) => e.text), ["A", "B", "C"]);
});

test("recentDialogue respects the character budget, keeping the newest lines", () => {
  const recent = context.recentDialogue(subtitles, 1190, { maxChars: 60 });
  assert.ok(recent.length < 19);
  assert.strictEqual(recent[recent.length - 1].text, "Line 119");
});

test("formatDialogue adds timestamps", () => {
  assert.strictEqual(context.formatDialogue(subtitles.slice(0, 2)), "[00:00:00] Line 0\n[00:00:10] Line 1");
});

test("fingerprint changes when new captions arrive", () => {
  assert.strictEqual(context.fingerprint(subtitles.slice(0, 50)), context.fingerprint(subtitles.slice(0, 50)));
  assert.notStrictEqual(context.fingerprint(subtitles.slice(0, 50)), context.fingerprint(subtitles.slice(0, 51)));
});

test("a saved summary that covers later scenes is kept out of chat", () => {
  const record = { episodeMemory: { summary: "S", coverage: { endSeconds: 2400 } } };
  assert.strictEqual(context.spoilerSafeMemory(record, 600), null); // viewer rewound to 10:00
  assert.ok(context.spoilerSafeMemory(record, 2410)); // viewer is past it
});