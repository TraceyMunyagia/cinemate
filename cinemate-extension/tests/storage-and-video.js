// tests/storage-and-video.js
// Checks video-id detection and per-video storage using a fake chrome.storage.
// Run from cinemate-extension/:  node tests/storage-and-video.js

const assert = require("assert");

// ---- Minimal in-memory stand-in for chrome.storage.local ----
const data = {};
const listeners = [];

function pick(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
}

function notify(changes) {
  listeners.forEach((listener) => listener(changes, "local"));
}

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        return pick(keys);
      },
      async set(items) {
        const changes = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: data[key], newValue: value };
          data[key] = structuredClone(value);
        }
        notify(changes);
      },
      async remove(keys) {
        const changes = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          if (key in data) changes[key] = { oldValue: data[key] };
          delete data[key];
        }
        notify(changes);
      },
    },
    onChanged: {
      addListener(listener) {
        listeners.push(listener);
      },
    },
  },
};

require("../utils/storage.js");
require("../utils/videoInfo.js");
const { storage, video } = globalThis.CineMate;

const at = (href) => new URL(href);

(async () => {
  // ---- Video ids ----
  assert.strictEqual(video.getVideoId(at("https://www.youtube.com/watch?v=abc123XYZ_-&t=40")), "youtube-abc123XYZ_-");
  assert.strictEqual(video.getVideoId(at("https://www.youtube.com/shorts/short_ID-9")), "youtube-short_ID-9");
  assert.strictEqual(video.getVideoId(at("https://www.youtube.com/")), null);
  assert.strictEqual(video.getVideoId(at("https://www.netflix.com/watch/81234567?trackId=1")), "netflix-81234567");
  assert.strictEqual(video.getVideoId(at("https://www.netflix.com/browse")), null);

  // ---- Per-video subtitles ----
  const episodeA = { videoId: "netflix-1", platform: "netflix", title: "Episode A", url: "x" };
  const episodeB = { videoId: "netflix-2", platform: "netflix", title: "Episode B", url: "y" };

  data.subtitles = [{ time: "00:00:01", text: "old shared list" }];
  await storage.removeLegacyData();
  assert.ok(!("subtitles" in data), "legacy list removed");

  await storage.saveSubtitles(episodeA, [{ time: "00:00:01", seconds: 1, text: "A line" }]);
  await storage.saveSubtitles(episodeB, [{ time: "00:00:05", seconds: 5, text: "B line" }]);

  assert.deepStrictEqual((await storage.getSubtitles("netflix-1")).map((e) => e.text), ["A line"]);
  assert.deepStrictEqual((await storage.getSubtitles("netflix-2")).map((e) => e.text), ["B line"]);

  const sessions = await storage.listSessions();
  assert.deepStrictEqual(sessions.map((s) => s.videoId), ["netflix-2", "netflix-1"]);

  // ---- Active video ----
  await storage.setActiveVideo(episodeA);
  assert.strictEqual((await storage.getActiveVideo()).videoId, "netflix-1");

  // ---- Clearing ----
  let sawClear = false;
  storage.watch((changes) => {
    const change = changes[storage.subtitleKey("netflix-1")];
    if (change && change.newValue === undefined) sawClear = true;
  });
  await storage.clearSubtitles("netflix-1");
  assert.deepStrictEqual(await storage.getSubtitles("netflix-1"), []);
  assert.ok(sawClear, "watchers hear about cleared captions");

  // ---- Old sessions are pruned ----
  for (let i = 0; i < storage.MAX_SESSIONS + 3; i++) {
    await storage.saveSubtitles(
      { videoId: `youtube-v${i}`, platform: "youtube", title: `Video ${i}`, url: "" },
      [{ time: "00:00:00", seconds: 0, text: `line ${i}` }]
    );
  }
  assert.strictEqual((await storage.listSessions()).length, storage.MAX_SESSIONS);
  assert.deepStrictEqual(await storage.getSubtitles("youtube-v0"), [], "oldest video deleted");

  // ---- Per-video cap ----
  const many = Array.from({ length: storage.MAX_ENTRIES + 10 }, (_, i) => ({ time: "", seconds: i, text: `${i}` }));
  await storage.saveSubtitles(episodeB, many);
  const saved = await storage.getSubtitles("netflix-2");
  assert.strictEqual(saved.length, storage.MAX_ENTRIES);
  assert.strictEqual(saved[0].text, "10", "oldest lines dropped first");

  // ---- Chat history per video (Week 3) ----
  await storage.appendHistory("netflix-2", { role: "user", content: "Who is she?" });
  await storage.appendHistory("netflix-2", { role: "assistant", content: "Amara." });
  await storage.appendHistory("youtube-v5", { role: "user", content: "Different video" });

  assert.deepStrictEqual((await storage.getHistory("netflix-2")).map((t) => t.content), ["Who is she?", "Amara."]);
  assert.strictEqual((await storage.getHistory("youtube-v5")).length, 1, "histories are separate");
  assert.deepStrictEqual(await storage.getHistory(null), [], "no video = its own empty chat");

  const longChat = Array.from({ length: storage.MAX_HISTORY_TURNS + 5 }, (_, i) => ({ role: "user", content: `${i}` }));
  await storage.saveHistory("netflix-2", longChat);
  assert.strictEqual((await storage.getHistory("netflix-2")).length, storage.MAX_HISTORY_TURNS);

  await storage.clearHistory("netflix-2");
  assert.deepStrictEqual(await storage.getHistory("netflix-2"), []);

  // ---- getSession / forgetSession ----
  assert.strictEqual((await storage.getSession("youtube-v5")).title, "Video 5");
  await storage.forgetSession("youtube-v5");
  assert.strictEqual(await storage.getSession("youtube-v5"), null);
  assert.deepStrictEqual(await storage.getSubtitles("youtube-v5"), []);
  assert.deepStrictEqual(await storage.getHistory("youtube-v5"), []);

  // ---- Legacy shared chat is removed ----
  data.cinemateHistory = [{ role: "user", content: "old" }];
  await storage.removeLegacyData();
  assert.ok(!("cinemateHistory" in data));
  assert.deepStrictEqual(await storage.getVoiceSettings(), storage.DEFAULT_VOICE_SETTINGS, "defaults");
  await storage.saveVoiceSettings({ output: "off", language: "en-KE" });
  const voice = await storage.getVoiceSettings();
  assert.strictEqual(voice.output, "off");
  assert.strictEqual(voice.language, "en-KE");
  assert.strictEqual(voice.input, "browser", "untouched settings keep their defaults");

  console.log("✅ Storage and video detection work");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
