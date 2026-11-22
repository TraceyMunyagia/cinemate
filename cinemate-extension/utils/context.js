// utils/context.js
// What the panel sends to the backend. The spoiler guard starts here: only
// captions up to the viewer's current playback time ever leave the browser.

(function (root) {
  const CineMate = (root.CineMate = root.CineMate || {});

  const CHAT_SEND_WINDOW_SECONDS = 600; // the backend narrows this to ~3 minutes
  const MIN_LINES = 6;

  const hasNumber = (value) => typeof value === "number" && Number.isFinite(value);

  // Captions at or before the viewer's position (all of them if unknown).
  function upTo(entries, currentSeconds) {
    const list = Array.isArray(entries) ? entries : [];
    if (!hasNumber(currentSeconds)) return list;
    return list.filter((entry) => entry.seconds <= currentSeconds + 1);
  }

  // A trimmed set for /chat, so we don't post a whole film every message.
  function forChat(entries, currentSeconds, windowSeconds = CHAT_SEND_WINDOW_SECONDS) {
    const visible = upTo(entries, currentSeconds);
    if (visible.length === 0) return [];

    const end = hasNumber(currentSeconds) ? currentSeconds : visible[visible.length - 1].seconds;
    const recent = visible.filter((entry) => entry.seconds >= end - windowSeconds);

    return recent.length >= MIN_LINES ? recent : visible.slice(-MIN_LINES);
  }

  // Asks the video's tab for the current playback time.
  // Returns { videoId, seconds, paused } or null if the tab can't be reached
  // or has moved on to a different video.
  async function getPlayback(activeVideo) {
    if (!activeVideo?.tabId) return null;

    try {
      const reply = await chrome.tabs.sendMessage(activeVideo.tabId, { action: "getPlayback" });
      if (!reply || reply.videoId !== activeVideo.videoId || !hasNumber(reply.seconds)) return null;
      return reply;
    } catch {
      return null;
    }
  }

  CineMate.context = { upTo, forChat, getPlayback };
})(globalThis);