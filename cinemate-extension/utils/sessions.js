// utils/sessions.js
// Helpers for the panel's Sessions tab and the summary spoiler check.
// No Chrome or DOM calls here, so they can be tested in Node.

(function (root) {
  const CineMate = (root.CineMate = root.CineMate || {});

  const SPOILER_GRACE_SECONDS = 30;
  const PLATFORM_ICONS = { youtube: "▶️", netflix: "🅽" };

  const hasNumber = (value) => typeof value === "number" && Number.isFinite(value);

  // True if a saved summary covers scenes after the viewer's position.
  function isMemoryAhead(memory, currentSeconds, graceSeconds = SPOILER_GRACE_SECONDS) {
    const coveredUntil = memory?.coverage?.endSeconds;
    if (!hasNumber(coveredUntil) || !hasNumber(currentSeconds)) return false;
    return coveredUntil > currentSeconds + graceSeconds;
  }

  function timeAgo(timestamp, now = Date.now()) {
    const minutes = Math.floor((now - timestamp) / 60000);
    if (!hasNumber(minutes) || minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;

    const days = Math.floor(hours / 24);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }

  // Local sessions (captions in the browser) + saved memories (backend),
  // matched by videoId. Newest first, the video on screen at the top.
  function mergeSessions(sessions, memories, activeVideoId) {
    const memoryById = new Map((memories || []).map((memory) => [memory.episodeId, memory]));

    return (sessions || [])
      .map((session) => {
        const memory = memoryById.get(session.videoId) || null;

        return {
          ...session,
          title: session.title || memory?.title || "Untitled video",
          icon: PLATFORM_ICONS[session.platform] || "🎬",
          isActive: session.videoId === activeVideoId,
          memory: memory
            ? { coveredUntil: memory.coveredUntil, summary: memory.summary || "" }
            : null,
        };
      })
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  CineMate.sessions = { isMemoryAhead, timeAgo, mergeSessions, SPOILER_GRACE_SECONDS };
})(globalThis);