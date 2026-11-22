// utils/timestamps.js
// Time helpers shared by the content script, the panel and the Node tests.
// Loaded as a classic script, so everything hangs off one global namespace.

(function (root) {
  const CineMate = (root.CineMate = root.CineMate || {});

  // 75.4 -> "00:01:15"
  function formatTime(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hrs = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const mins = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    return `${hrs}:${mins}:${secs}`;
  }

  // "01:02:03" -> 3723, "02:03" -> 123, anything invalid -> 0
  function parseTime(text) {
    const parts = String(text || "")
      .split(":")
      .map((part) => Number(part));

    if (parts.length === 0 || parts.some((part) => Number.isNaN(part))) return 0;

    return parts.reduce((total, part) => total * 60 + part, 0);
  }

  // YouTube can have more than one <video> (ads, hover previews).
  // The main player is the biggest one on the page.
  function getVideoElement(doc) {
    const videos = Array.from((doc || document).querySelectorAll("video"));
    if (videos.length === 0) return null;

    return videos.reduce((biggest, video) => {
      const area = video.clientWidth * video.clientHeight;
      const biggestArea = biggest.clientWidth * biggest.clientHeight;
      return area > biggestArea ? video : biggest;
    });
  }

  function getPlaybackSeconds(doc) {
    const video = getVideoElement(doc);
    return video ? video.currentTime : 0;
  }

  CineMate.time = { formatTime, parseTime, getVideoElement, getPlaybackSeconds };
})(globalThis);