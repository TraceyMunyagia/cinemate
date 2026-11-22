// utils/storage.js
// One place for everything CineMate keeps in chrome.storage.local.
//
//   cinemateActiveVideo     -> { videoId, platform, title, url, activatedAt }
//   cinemateSessions        -> [{ videoId, platform, title, url, count, updatedAt }]
//   subtitles:<videoId>     -> [{ time, seconds, text }]
//
// Used by both the content script and the discussion panel.

(function (root) {
  const CineMate = (root.CineMate = root.CineMate || {});

  const KEYS = {
    ACTIVE: "cinemateActiveVideo",
    SESSIONS: "cinemateSessions",
    LEGACY_SUBTITLES: "subtitles", // the old single shared list
  };

  const MAX_SESSIONS = 15; // older videos' captions get deleted
  const MAX_ENTRIES = 5000; // per video, oldest dropped first

  const area = () => chrome.storage.local;
  const subtitleKey = (videoId) => `subtitles:${videoId}`;

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
      await area().remove(drop.map((session) => subtitleKey(session.videoId)));
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

  // The pre-Week-1 build kept every video's captions in one "subtitles" list.
  async function removeLegacyData() {
    await area().remove(KEYS.LEGACY_SUBTITLES);
  }

  // callback(changes) runs whenever anything in local storage changes.
  function watch(callback) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local") callback(changes);
    });
  }

  CineMate.storage = {
    KEYS,
    MAX_ENTRIES,
    MAX_SESSIONS,
    subtitleKey,
    getActiveVideo,
    setActiveVideo,
    getSubtitles,
    saveSubtitles,
    clearSubtitles,
    listSessions,
    removeLegacyData,
    watch,
  };
})(globalThis);