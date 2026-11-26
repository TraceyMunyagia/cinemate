// tests/voiceService.test.js  –  run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { createVoiceService } = require("../services/voiceService");

const VOICE = {
  useLocalWhisper: true,
  useLocalTts: true,
  whisperModel: "tiny",
  pythonBin: "python3",
  openaiApiKey: "",
};

const enoent = () => Object.assign(new Error("spawn python3 ENOENT"), { code: "ENOENT" });

// A fake `run` that answers like the real programs would.
function fakeRun({ python = true, ffmpeg = true, modules = ["whisper", "pyttsx3"], script } = {}) {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args].join(" "));

    if (command === "ffmpeg") {
      if (!ffmpeg) throw enoent();
      return "ffmpeg version 7";
    }
    if (!python) throw enoent();
    if (args[0] === "--version") return "Python 3.12.1";
    if (args[0] === "-c") {
      const name = args[1].replace("import ", "");
      if (!modules.includes(name)) throw new Error(`No module named '${name}'`);
      return "";
    }
    return script ? script(args) : JSON.stringify({ success: true, transcript: "hello" });
  };
  return { run, calls };
}

test("reports everything available when Python, the packages and ffmpeg are there", async () => {
  const voice = createVoiceService({ voice: VOICE, run: fakeRun().run });
  const status = await voice.getStatus();

  assert.strictEqual(status.transcription.available, true);
  assert.strictEqual(status.speech.available, true);
  assert.strictEqual(status.transcription.problem, null);
});

test("explains a missing Python, with the PYTHON_BIN fix", async () => {
  const voice = createVoiceService({ voice: VOICE, run: fakeRun({ python: false }).run });
  const status = await voice.getStatus();

  assert.strictEqual(status.transcription.available, false);
  assert.match(status.transcription.problem, /Python wasn't found at "python3"\. Set PYTHON_BIN/);
});

test("explains a missing package, with the pip command", async () => {
  const voice = createVoiceService({ voice: VOICE, run: fakeRun({ modules: ["pyttsx3"] }).run });
  const status = await voice.getStatus();

  assert.match(status.transcription.problem, /openai-whisper isn't installed\. Run: python3 -m pip install/);
  assert.strictEqual(status.speech.available, true);
});

test("explains a missing ffmpeg", async () => {
  const voice = createVoiceService({ voice: VOICE, run: fakeRun({ ffmpeg: false }).run });
  assert.match((await voice.getStatus()).speech.problem, /ffmpeg isn't installed/);
});

test("caches the status for a minute", async () => {
  let t = 0;
  const fake = fakeRun();
  const voice = createVoiceService({ voice: VOICE, run: fake.run, now: () => t });

  await voice.getStatus();
  const callsAfterFirst = fake.calls.length;
  t = 30000;
  await voice.getStatus();
  assert.strictEqual(fake.calls.length, callsAfterFirst, "second call used the cache");

  t = 61000;
  await voice.getStatus();
  assert.ok(fake.calls.length > callsAfterFirst, "re-checked after a minute");
});

test("transcribes with local Whisper", async () => {
  const voice = createVoiceService({ voice: VOICE, run: fakeRun().run });
  const result = await voice.transcribeAudio(Buffer.from("fake audio"), "audio/webm");
  assert.deepStrictEqual(result, { provider: "local-whisper", transcript: "hello" });
});

test("a missing Python becomes a clear 503", async () => {
  const voice = createVoiceService({ voice: VOICE, run: fakeRun({ python: false }).run });

  await assert.rejects(voice.transcribeAudio(Buffer.from("x"), "audio/webm"), (error) => {
    assert.strictEqual(error.status, 503);
    assert.strictEqual(error.code, "VOICE_UNAVAILABLE");
    assert.match(error.message, /PYTHON_BIN/);
    return true;
  });
});

test("a script's 'No module named' error becomes a 503 with the pip command", async () => {
  const script = () => {
    const error = new Error("exit 1");
    error.stdout = JSON.stringify({ success: false, error: "No module named 'whisper'" });
    throw error;
  };
  const voice = createVoiceService({ voice: VOICE, run: fakeRun({ script }).run });

  await assert.rejects(voice.transcribeAudio(Buffer.from("x"), "audio/webm"), /pip install -r requirements-local-voice\.txt/);
});

test("server TTS turned off is a 503 that points to the browser voice", async () => {
  const voice = createVoiceService({ voice: { ...VOICE, useLocalTts: false }, run: fakeRun().run });
  await assert.rejects(voice.synthesizeSpeech("hi"), (error) => error.status === 503 && /browser's voice/.test(error.message));
});