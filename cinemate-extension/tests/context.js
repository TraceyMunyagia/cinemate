// tests/context.js
// Checks what the panel sends for chat and summaries.
// Run from cinemate-extension/:  node tests/context.js

const assert = require("assert");

require("../utils/timestamps.js");
require("../utils/context.js");
const { context, time } = globalThis.CineMate;

// One line every 10 seconds for 30 minutes.
const entries = Array.from({ length: 180 }, (_, i) => ({
  time: time.formatTime(i * 10),
  seconds: i * 10,
  text: `Line ${i}`,
}));

// Spoiler guard
const visible = context.upTo(entries, 600);
assert.strictEqual(visible[visible.length - 1].text, "Line 60");
assert.strictEqual(context.upTo(entries, null).length, 180, "unknown position = everything");

// Chat window: the 10 minutes before the viewer's position
const chat = context.forChat(entries, 1200);
assert.strictEqual(chat[0].text, "Line 60");
assert.strictEqual(chat[chat.length - 1].text, "Line 120");

// Quiet scene: still sends the last few lines
const sparse = [
  { time: "00:01:00", seconds: 60, text: "A" },
  { time: "00:40:00", seconds: 2400, text: "B" },
];
assert.deepStrictEqual(context.forChat(sparse, 3000).map((e) => e.text), ["A", "B"]);

// getPlayback ignores a tab that has moved to another video
globalThis.chrome = {
  tabs: { sendMessage: async () => ({ videoId: "youtube-other", seconds: 42, paused: false }) },
};

(async () => {
  assert.strictEqual(await context.getPlayback({ videoId: "youtube-abc", tabId: 7 }), null);
  assert.strictEqual(await context.getPlayback({ videoId: "youtube-abc" }), null, "no tabId");

  chrome.tabs.sendMessage = async () => ({ videoId: "youtube-abc", seconds: 42, paused: true });
  assert.deepStrictEqual(await context.getPlayback({ videoId: "youtube-abc", tabId: 7 }), {
    videoId: "youtube-abc",
    seconds: 42,
    paused: true,
  });

  chrome.tabs.sendMessage = async () => {
    throw new Error("Could not establish connection");
  };
  assert.strictEqual(await context.getPlayback({ videoId: "youtube-abc", tabId: 7 }), null);

  console.log("✅ Chat context and spoiler guard work");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
