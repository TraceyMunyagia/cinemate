// tests/listen.js
// Checks voice input with a fake Chrome speech recogniser and microphone.
// Run from cinemate-extension/:  node tests/listen.js

const assert = require("assert");

let micAllowed = true;
let lastRecognizer = null;

// Node 21+ has its own read-only `navigator`, so replace it explicitly.
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    language: "en-KE",
    mediaDevices: {
      async getUserMedia() {
        if (!micAllowed) throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
        return { getTracks: () => [{ stop() {} }] };
      },
    },
  },
});

// Fake recogniser: the test drives it with say() / finish() / fail().
globalThis.webkitSpeechRecognition = class {
  constructor() {
    lastRecognizer = this;
    this.results = [];
  }
  start() {}
  stop() {
    this.onend?.();
  }
  abort() {
    this.onerror?.({ error: "aborted" });
    this.onend?.();
  }
  say(text, isFinal) {
    const result = [{ transcript: text }];
    result.isFinal = isFinal;
    if (this.results.length && !this.results[this.results.length - 1].isFinal) this.results.pop();
    this.results.push(result);
    this.onresult?.({ results: this.results });
  }
  fail(error) {
    this.onerror?.({ error });
    this.onend?.();
  }
};

require("../utils/listen.js");
const { listen } = globalThis.CineMate;

(async () => {
  assert.strictEqual(listen.isBrowserSupported(), true);

  // ---- Words appear as you speak, then the final text comes back ----
  const interim = [];
  const session = await listen.start({ input: "browser" }, { onInterim: (text) => interim.push(text) });
  assert.strictEqual(lastRecognizer.lang, "en-KE", "uses the browser's language by default");

  lastRecognizer.say("why did", false);
  lastRecognizer.say("why did she leave", true);
  lastRecognizer.stop();

  assert.deepStrictEqual(await session.result, { transcript: "why did she leave", source: "browser" });
  assert.deepStrictEqual(interim, ["why did", "why did she leave"]);

  // ---- Language setting is used ----
  await listen.start({ input: "browser", language: "en-GB" });
  assert.strictEqual(lastRecognizer.lang, "en-GB");

  // ---- Silence gives an empty transcript, not an error ----
  const quiet = await listen.start({ input: "browser" });
  lastRecognizer.fail("no-speech");
  assert.strictEqual((await quiet.result).transcript, "");

  // ---- cancel() throws away what was heard ----
  const cancelled = await listen.start({ input: "browser" });
  lastRecognizer.say("never mind", false);
  cancelled.cancel();
  assert.strictEqual((await cancelled.result).transcript, "");

  // ---- No internet ----
  const offline = await listen.start({ input: "browser" });
  lastRecognizer.fail("network");
  await assert.rejects(offline.result, /needs an internet connection/);

  // ---- Microphone blocked (checked before recognition starts) ----
  // Mic access is remembered once granted, so load a fresh copy for this check.
  delete require.cache[require.resolve("../utils/listen.js")];
  micAllowed = false;
  require("../utils/listen.js");
  await assert.rejects(globalThis.CineMate.listen.start({ input: "browser" }), (error) => {
    assert.strictEqual(error.code, "not-allowed");
    assert.match(error.message, /chrome:\/\/settings\/content\/microphone/);
    return true;
  });

  // ---- No speech recognition at all ----
  delete globalThis.webkitSpeechRecognition;
  assert.strictEqual(globalThis.CineMate.listen.isBrowserSupported(), false);
  await assert.rejects(globalThis.CineMate.listen.start({ input: "browser" }), /type instead/);

  console.log("✅ Voice input works");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});