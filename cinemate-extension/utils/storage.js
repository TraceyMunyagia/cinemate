// utils/storage.js
// One place for everything CineMate keeps in chrome.storage.local.
//
//   cinemateActiveVideo     -> { videoId, platform, title, url, activatedAt }
//   cinemateSessions        -> [{ videoId, platform, title, url, count, updatedAt }]
//   subtitles:<videoId>     -> [{ time, seconds, text }]
//   history:<videoId>       -> [{ role: "user" | "assistant", content }]
//   cinemateVoiceSettings   -> { input, output, language, whileTalking, autoSend }
//   cinemateSettings        -> { backendUrl, spoilerGuard }
//   cinematePersonality     -> "filmCritic" | "casualFriend" | "theoryAnalyst"
//
// Used by both the content script and the discussion panel.

(function (root) {
  const CineMate = (root.CineMate = root.CineMate || {});

  const KEYS = {
    ACTIVE: "cinemateActiveVideo",
    SESSIONS: "cinemateSessions",
    LEGACY_SUBTITLES: "subtitles", // the old single shared list
    LEGACY_HISTORY: "cinemateHistory", // the old single shared chat
    VOICE: "cinemateVoiceSettings",
    SETTINGS: "cinemateSettings",
    PERSONALITY: "cinematePersonality",
  };

  const DEFAULT_SETTINGS = {
    backendUrl: "http://localhost:3000",
    spoilerGuard: true, // false = CineMate may talk about scenes you haven't reached
  };

  const PERSONALITIES = [
    { id: "filmCritic", label: "🎬 Critic" },
    { id: "casualFriend", label: "😊 Friend" },
    { id: "theoryAnalyst", label: "🕵️ Theorist" },
  ];
  const DEFAULT_PERSONALITY = "casualFriend";

  const DEFAULT_VOICE_SETTINGS = {
    input: "browser", // "browser" = Chrome speech recognition | "server" = backend Whisper
    output: "browser", // "browser" = Chrome voice | "server" = backend pyttsx3 | "off" = text only
    language: "", // "" = the browser's language, e.g. "en-KE" or "en-US"
    whileTalking: "pause", // what the video does while you talk and CineMate replies: "pause" | "duck" | "off"
    autoSend: true, // send as soon as you stop talking
  };

  const MAX_SESSIONS = 15; // older videos' captions get deleted
  const MAX_ENTRIES = 5000; // per video, oldest dropped first
  const MAX_HISTORY_TURNS = 100; // per video; the backend only uses the last 10

  const area = () => chrome.storage.local;

  // Read-change-write updates run one at a time, so two quick changes
  // (e.g. two settings toggled together) can't overwrite each other.
  let writeChain = Promise.resolve();
  function oneAtATime(task) {
    const run = writeChain.then(task, task);
    writeChain = run.catch(() => {});
    return run;
  }

  const subtitleKey = (videoId) => `subtitles:${videoId}`;
  const historyKey = (videoId) => `history:${videoId || "none"}`; // "none" = no video open

  async function getActiveVideo() {
    const result = await area().get(KEYS.ACTIVE);
    return result[KEYS.ACTIVE] || null;
  }

  async function setActiveVideo(video) {
    if (!video?.videoId) return;
    await area().set({ [KEYS.ACTIVE]: { ...video, activatedAt: Date.now() } });
  }

  async function getSubtitles(videoId) {
    if (!videoId) return [];
    const key = subtitleKey(videoId);
    const result = await area().get(key);
    return Array.isArray(result[key]) ? result[key] : [];
  }

  async function listSessions() {
    const result = await area().get(KEYS.SESSIONS);
    return Array.isArray(result[KEYS.SESSIONS]) ? result[KEYS.SESSIONS] : [];
  }

  // Move this video to the top of the session list and prune old ones.
  async function touchSession(video, count) {
    const sessions = await listSessions();
    const others = sessions.filter((session) => session.videoId !== video.videoId);

    const updated = [
      {
        videoId: video.videoId,
        platform: video.platform,
        title: video.title,
        url: video.url,
        count,
        updatedAt: Date.now(),
      },
      ...others,
    ];

    const keep = updated.slice(0, MAX_SESSIONS);
    const drop = updated.slice(MAX_SESSIONS);

    await area().set({ [KEYS.SESSIONS]: keep });

    if (drop.length > 0) {
      await area().remove(
        drop.flatMap((session) => [subtitleKey(session.videoId), historyKey(session.videoId)])
      );
    }
  }

  async function saveSubtitles(video, entries) {
    if (!video?.videoId) return;
    const trimmed = entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries;

    await area().set({ [subtitleKey(video.videoId)]: trimmed });
    await touchSession(video, trimmed.length);
  }

  async function clearSubtitles(videoId) {
    if (!videoId) return;
    await area().remove(subtitleKey(videoId));

    const sessions = await listSessions();
    await area().set({
      [KEYS.SESSIONS]: sessions.map((session) =>
        session.videoId === videoId ? { ...session, count: 0 } : session
      ),
    });
  }

  async function getSession(videoId) {
    const sessions = await listSessions();
    return sessions.find((session) => session.videoId === videoId) || null;
  }

  // ---------- Chat history (one per video) ----------

  async function getHistory(videoId) {
    const key = historyKey(videoId);
    const result = await area().get(key);
    return Array.isArray(result[key]) ? result[key] : [];
  }

  async function saveHistory(videoId, turns) {
    const trimmed = turns.length > MAX_HISTORY_TURNS ? turns.slice(-MAX_HISTORY_TURNS) : turns;
    await area().set({ [historyKey(videoId)]: trimmed });
    return trimmed;
  }

  function appendHistory(videoId, turn) {
    return oneAtATime(async () => {
      const turns = await getHistory(videoId);
      return saveHistory(videoId, [...turns, turn]);
    });
  }

  async function clearHistory(videoId) {
    await area().remove(historyKey(videoId));
  }

  // "Forget" in the Sessions tab: captions, chat and the session entry.
  async function forgetSession(videoId) {
    await area().remove([subtitleKey(videoId), historyKey(videoId)]);

    const sessions = await listSessions();
    await area().set({
      [KEYS.SESSIONS]: sessions.filter((session) => session.videoId !== videoId),
    });
  }

  // ---------- Voice settings ----------

  async function getVoiceSettings() {
    const result = await area().get(KEYS.VOICE);
    return { ...DEFAULT_VOICE_SETTINGS, ...(result[KEYS.VOICE] || {}) };
  }

  function saveVoiceSettings(changes) {
    return oneAtATime(async () => {
      const settings = { ...(await getVoiceSettings()), ...changes };
      await area().set({ [KEYS.VOICE]: settings });
      return settings;
    });
  }

  // ---------- General settings ----------

  // "localhost:3000/" -> "http://localhost:3000"; null if it isn't a usable URL.
  function normalizeBackendUrl(text) {
    let value = String(text || "").trim();
    if (!value) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) return null; // ftp://, file://…
    if (!/^https?:\/\//i.test(value)) value = `http://${value}`;

    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || !url.hostname) return null;
      return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
    } catch {
      return null;
    }
  }

  async function getSettings() {
    const result = await area().get(KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(result[KEYS.SETTINGS] || {}) };
  }

  function saveSettings(changes) {
    return oneAtATime(async () => {
      const next = { ...(await getSettings()), ...changes };

      const backendUrl = normalizeBackendUrl(next.backendUrl);
      if (!backendUrl) throw new Error("That doesn't look like a server address, e.g. http://localhost:3000");

      const settings = { ...next, backendUrl, spoilerGuard: next.spoilerGuard !== false };
      await area().set({ [KEYS.SETTINGS]: settings });
      return settings;
    });
  }

  async function getPersonality() {
    const result = await area().get(KEYS.PERSONALITY);
    const id = result[KEYS.PERSONALITY];
    return PERSONALITIES.some((p) => p.id === id) ? id : DEFAULT_PERSONALITY;
  }

  async function savePersonality(id) {
    const valid = PERSONALITIES.some((p) => p.id === id) ? id : DEFAULT_PERSONALITY;
    await area().set({ [KEYS.PERSONALITY]: valid });
    return valid;
  }

  // Earlier builds kept every video's captions and chat in one shared list.
  async function removeLegacyData() {
    await area().remove([KEYS.LEGACY_SUBTITLES, KEYS.LEGACY_HISTORY]);
  }

  // callback(changes) runs whenever anything in local storage changes.
  function watch(callback) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local") callback(changes);
    });
  }

  CineMate.storage = {
    KEYS,
    DEFAULT_VOICE_SETTINGS,
    DEFAULT_SETTINGS,
    PERSONALITIES,
    DEFAULT_PERSONALITY,
    MAX_ENTRIES,
    MAX_SESSIONS,
    MAX_HISTORY_TURNS,
    subtitleKey,
    historyKey,
    getActiveVideo,
    setActiveVideo,
    getSubtitles,
    saveSubtitles,
    clearSubtitles,
    listSessions,
    getSession,
    getHistory,
    saveHistory,
    appendHistory,
    clearHistory,
    forgetSession,
    getVoiceSettings,
    saveVoiceSettings,
    normalizeBackendUrl,
    getSettings,
    saveSettings,
    getPersonality,
    savePersonality,
    removeLegacyData,
    watch,
  };
})(globalThis);