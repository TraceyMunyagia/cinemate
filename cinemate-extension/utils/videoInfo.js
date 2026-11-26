// utils/videoInfo.js
// Works out which platform and which video the current tab is showing.
// The videoId is "<platform>-<id>", e.g. "youtube-dQw4w9WgXcQ" or "netflix-81234567".

(function (root) {
  const CineMate = (root.CineMate = root.CineMate || {});

  function getPlatform(loc) {
    const host = (loc || location).hostname;
    if (host.includes("youtube.com")) return "youtube";
    if (host.includes("netflix.com")) return "netflix";
    return null;
  }

  // The platform's own id for the video, or null if this isn't a watch page.
  function getPlatformVideoId(loc) {
    const here = loc || location;
    const platform = getPlatform(here);
    const url = new URL(here.href);

    if (platform === "youtube") {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const shorts = url.pathname.match(/^\/shorts\/([\w-]+)/);
      return shorts ? shorts[1] : null;
    }

    if (platform === "netflix") {
      const watch = url.pathname.match(/^\/watch\/(\d+)/);
      return watch ? watch[1] : null;
    }

    return null;
  }

  function getVideoId(loc) {
    const platform = getPlatform(loc);
    const id = getPlatformVideoId(loc);
    return platform && id ? `${platform}-${id}` : null;
  }

  // Title the site gave the browser's media controls (lock screen, media keys).
  function getMediaSessionTitle() {
    try {
      const metadata = navigator.mediaSession?.metadata;
      if (!metadata?.title) return "";
      return metadata.artist ? `${metadata.title} · ${metadata.artist}` : metadata.title;
    } catch {
      return "";
    }
  }

  // YouTube keeps the previous video's heading on screen for a moment after
  // switching videos. <ytd-watch-flexy video-id="..."> says which video the
  // page currently shows, so only trust the heading when it matches.
  function getYouTubeTitle(page, loc) {
    const id = getPlatformVideoId(loc);
    const watchPage = page.querySelector("ytd-watch-flexy");
    const pageVideoId = watchPage?.getAttribute("video-id");

    if (pageVideoId && pageVideoId !== id) return ""; // still showing the old video

    const heading = page.querySelector("h1.ytd-watch-metadata yt-formatted-string");
    const text = heading?.textContent?.trim();
    if (text) return text;

    const fromTab = page.title.replace(/^\(\d+\)\s*/, "").replace(/\s*-\s*YouTube$/, "").trim();
    return fromTab && fromTab !== "YouTube" ? fromTab : "";
  }

  // Netflix shows "Show · E3 · Episode name" only while the player controls
  // are visible, so the content script keeps whatever it found last.
  function getNetflixTitle(page) {
    const titleEl = page.querySelector('[data-uia="video-title"]');

    if (titleEl) {
      const parts = Array.from(titleEl.children)
        .map((child) => child.textContent.trim())
        .filter(Boolean);

      const text = parts.length > 0 ? parts.join(" · ") : titleEl.textContent.trim();
      if (text) return text;
    }

    return getMediaSessionTitle();
  }

  // Best-effort title; "" means "not known yet – try again later".
  function getVideoTitle(doc, loc) {
    const page = doc || document;
    const platform = getPlatform(loc);

    if (platform === "youtube") return getYouTubeTitle(page, loc) || getMediaSessionTitle();
    if (platform === "netflix") return getNetflixTitle(page);

    return "";
  }

  // Everything the rest of the extension needs about the current video.
  function getCurrentVideo(doc, loc) {
    const here = loc || location;
    const videoId = getVideoId(here);
    if (!videoId) return null;

    return {
      videoId,
      platform: getPlatform(here),
      title: getVideoTitle(doc, here),
      url: here.href,
    };
  }

  CineMate.video = {
    getPlatform,
    getPlatformVideoId,
    getVideoId,
    getVideoTitle,
    getCurrentVideo,
  };
})(globalThis);