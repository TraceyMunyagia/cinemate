// tests/speech.js
// Checks how CineMate splits replies for speaking, and that stop() works.
// Run from cinemate-extension/:  node tests/speech.js

const assert = require("assert");

// ---- A fake Chrome voice that "speaks" instantly ----
const spoken = [];
let queue = [];
globalThis.SpeechSynthesisUtterance = function (text) {
  this.text = text;
};
globalThis.speechSynthesis = {
  getVoices: () => [{ lang: "en-US", name: "US" }, { lang: "en-GB", name: "UK" }, { lang: "sw-KE", name: "Swahili" }],
  speak(utterance) {
    queue.push(utterance);
  },
  cancel() {
    const pending = queue;
    queue = [];
    pending.forEach((u) => u.onerror?.({ error: "interrupted" }));
  },
};
// Plays everything queued so far.
function playQueue() {
  const pending = queue;
  queue = [];
  pending.forEach((u) => {
    spoken.push(u.text);
    u.onend?.();
  });
}

require("../utils/speech.js");
const { speech } = globalThis.CineMate;

(async () => {
  // ---- splitForSpeech ----
  assert.deepStrictEqual(speech.splitForSpeech("Hi there. How are you?"), ["Hi there. How are you?"]);
  assert.deepStrictEqual(speech.splitForSpeech("   "), []);

  const long = "She lied about the keys. ".repeat(20);
  const chunks = speech.splitForSpeech(long);
  assert.ok(chunks.length > 1, "long replies are split");
  assert.ok(chunks.every((c) => c.length <= 180), "every chunk fits");
  assert.strictEqual(chunks.join(" "), long.trim(), "nothing is lost");

  const oneHugeSentence = "word ".repeat(100).trim();
  assert.ok(speech.splitForSpeech(oneHugeSentence).every((c) => c.length <= 180));

  // ---- pickVoice ----
  assert.strictEqual(speech.pickVoice("en-GB").name, "UK");
  assert.strictEqual(speech.pickVoice("en-KE").name, "US", "same base language");
  assert.strictEqual(speech.pickVoice("sw-KE").name, "Swahili");
  assert.strictEqual(speech.pickVoice("fr-FR"), null);

  // ---- Browser voice finishes ----
  const first = speech.speak("First sentence. Second sentence.", { output: "browser" });
  await new Promise((r) => setTimeout(r, 0));
  playQueue();
  assert.strictEqual(await first.done, "finished");
  assert.deepStrictEqual(spoken, ["First sentence. Second sentence."]);

  // ---- stop() cuts it off ----
  const second = speech.speak("This will be interrupted.", { output: "browser" });
  await new Promise((r) => setTimeout(r, 0));
  second.stop();
  assert.strictEqual(await second.done, "stopped");
  assert.strictEqual(queue.length, 0, "nothing left to say");

  // ---- output "off" says nothing ----
  const silent = speech.speak("Quiet please.", { output: "off" });
  assert.strictEqual(await silent.done, "finished");
  assert.strictEqual(queue.length, 0);

  // ---- server voice that answers 204 falls back to the browser ----
  globalThis.fetch = async () => ({ status: 204, ok: true });
  const fallback = speech.speak("Server said no.", { output: "server", apiBase: "http://x" });
  await new Promise((r) => setTimeout(r, 10));
  playQueue();
  assert.strictEqual(await fallback.done, "finished");
  assert.strictEqual(spoken[spoken.length - 1], "Server said no.");

  console.log("✅ Speech output works");
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});