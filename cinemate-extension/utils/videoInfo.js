// utils/videoInfo.js
// Works out which platform and which video the current tab is showing, by
// asking the matching adapter in platforms/. The videoId is
// "<platform>-<id>", e.g. "youtube-dQw4w9WgXcQ" or "netflix-81234567".

(function (root) {
  const CineMate = (root.CineMate = root.CineMate || {});

  const defaultDoc = () => (typeof document !== "undefined" ? document : null);
  const here = (loc) => loc || root.location;
  const adapterFor = (loc) => CineMate.platforms.forHost(here(loc)?.hostname);

  function getPlatform(loc) {
    return adapterFor(loc)?.id || null;
  }

  // The platform's own id for the video, or null if this isn't a watch page.
  function getPlatformVideoId(loc, doc) {
    const adapter = adapterFor(loc);
    if (!adapter) return null;
    return adapter.getVideoId(new URL(here(loc).href), doc || defaultDoc()) || null;
  }

  function getVideoId(loc, doc) {
    const platform = getPlatform(loc);
    const id = getPlatformVideoId(loc, doc);
    return platform && id ? `${platform}-${id}` : null;
  }

  // Best-effort title; "" means "not known yet – try again later".
  function getVideoTitle(doc, loc) {
    const adapter = adapterFor(loc);
    if (!adapter) return "";
    return adapter.getTitle(doc || defaultDoc(), new URL(here(loc).href)) || "";
  }

  // Caption text on screen right now.
  function readCaptions(doc, loc) {
    return adapterFor(loc)?.readCaptions(doc || defaultDoc()) || "";
  }

  // The main <video> – the adapter's choice, or the biggest one on the page.
  function getVideoElement(doc, loc) {
    const page = doc || defaultDoc();
    const adapter = adapterFor(loc);
    return adapter?.getVideoElement?.(page) || CineMate.time.getVideoElement(page);
  }

  // Everything the rest of the extension needs about the current video.
  function getCurrentVideo(doc, loc) {
    const page = doc || defaultDoc();
    const videoId = getVideoId(loc, page);
    if (!videoId) return null;

    return {
      videoId,
      platform: getPlatform(loc),
      title: getVideoTitle(page, loc),
      url: here(loc).href,
    };
  }

  CineMate.video = {
    getPlatform,
    getPlatformVideoId,
    getVideoId,
    getVideoTitle,
    readCaptions,
    getVideoElement,
    getCurrentVideo,
  };
})(globalThis);