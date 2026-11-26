// platforms/registry.js
// Each streaming site is one small "adapter" file in platforms/ that says how
// to find the video id, title, captions and player on that site. Everything
// else (videoInfo.js, content.js, the panel) asks the registry instead of
// hard-coding YouTube and Netflix.
//
// An adapter looks like:
// {
//   id: "youtube",                 // used in videoIds: "youtube-<id>"
//   label: "YouTube",
//   icon: "▶️",
//   hosts: ["youtube.com"],        // matches www.youtube.com, m.youtube.com, …
//   getVideoId(url, doc),          // the site's own id, or null if not watching
//   getTitle(doc, url),            // "" = not known yet
//   readCaptions(doc),             // caption text on screen right now ("" if none)
//   getVideoElement(doc),          // optional: the main <video>
// }

(function (root) {
  const CineMate = (root.CineMate = root.CineMate || {});

  const adapters = [];
  const REQUIRED = ["id", "label", "hosts", "getVideoId", "getTitle", "readCaptions"];

  function register(adapter) {
    const missing = REQUIRED.filter((key) => !adapter?.[key]);
    if (missing.length > 0) {
      throw new Error(`Platform adapter is missing: ${missing.join(", ")}`);
    }

    const existing = adapters.findIndex((a) => a.id === adapter.id);
    if (existing >= 0) adapters.splice(existing, 1);
    adapters.push(adapter);
  }

  function forHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return (
      adapters.find((adapter) =>
        adapter.hosts.some((h) => host === h || host.endsWith(`.${h}`))
      ) || null
    );
  }

  const byId = (id) => adapters.find((adapter) => adapter.id === id) || null;
  const list = () => adapters.slice();

  // ---------- Helpers shared by the adapters ----------

  // Text of every element matching a selector, joined with spaces.
  function textOf(doc, selector) {
    if (!doc?.querySelectorAll) return "";
    return Array.from(doc.querySelectorAll(selector))
      .map((el) => el.textContent.trim())
      .filter(Boolean)
      .join(" ");
  }

  // Title the site gave the browser's media controls (lock screen, media keys).
  function mediaSessionTitle() {
    try {
      const metadata = root.navigator?.mediaSession?.metadata;
      if (!metadata?.title) return "";
      return metadata.artist ? `${metadata.title} · ${metadata.artist}` : metadata.title;
    } catch {
      return "";
    }
  }

  // The biggest <video> inside `scope` that passes `filter` (players often
  // have hidden preview / ad videos too).
  function biggestVideo(scope, filter = () => true) {
    if (!scope?.querySelectorAll) return null;
    const videos = Array.from(scope.querySelectorAll("video")).filter(filter);
    if (videos.length === 0) return null;

    return videos.reduce((biggest, video) =>
      video.clientWidth * video.clientHeight > biggest.clientWidth * biggest.clientHeight ? video : biggest
    );
  }

  // "Season 1, Ep. 3 The Studio" -> "season-1-ep-3-the-studio"
  function slug(text, maxLength = 48) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, maxLength)
      .replace(/-$/, "");
  }

  CineMate.platforms = {
    register,
    forHost,
    byId,
    list,
    helpers: { textOf, mediaSessionTitle, biggestVideo, slug },
  };
})(globalThis);