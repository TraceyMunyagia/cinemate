// tests/video-titles.js
// Checks title detection with tiny stand-ins for the YouTube/Netflix pages.
// Run from cinemate-extension/:  node tests/video-titles.js

const assert = require("assert");

// Node 21+ has its own read-only `navigator`, so replace it explicitly.
Object.defineProperty(globalThis, "navigator", {
  value: { mediaSession: { metadata: null } },
  configurable: true,
});
require("../platforms/registry.js");
require("../platforms/youtube.js");
require("../platforms/netflix.js");
require("../utils/videoInfo.js");
const { video } = globalThis.CineMate;

const at = (href) => new URL(href);

// A fake document: `elements` maps a CSS selector to a fake element.
function fakePage({ title = "", elements = {} } = {}) {
  return {
    title,
    querySelector: (selector) => elements[selector] || null,
  };
}

const el = (text, attrs = {}, children = []) => ({
  textContent: text,
  children,
  getAttribute: (name) => attrs[name] ?? null,
});

const HEADING = "h1.ytd-watch-metadata yt-formatted-string";
const NETFLIX_TITLE = '[data-uia="video-title"]';

// ---- YouTube ----
const watchUrl = at("https://www.youtube.com/watch?v=NEW123");

assert.strictEqual(
  video.getVideoTitle(
    fakePage({ elements: { "ytd-watch-flexy": el("", { "video-id": "NEW123" }), [HEADING]: el(" Making the Album ") } }),
    watchUrl
  ),
  "Making the Album"
);

assert.strictEqual(
  video.getVideoTitle(
    fakePage({
      title: "Old Video - YouTube",
      elements: { "ytd-watch-flexy": el("", { "video-id": "OLD999" }), [HEADING]: el("Old Video") },
    }),
    watchUrl
  ),
  "",
  "the old video's heading is ignored right after switching"
);

assert.strictEqual(
  video.getVideoTitle(fakePage({ title: "(3) Making the Album - YouTube" }), watchUrl),
  "Making the Album",
  "falls back to the tab title"
);

// ---- Netflix ----
const netflixUrl = at("https://www.netflix.com/watch/81234567");

assert.strictEqual(
  video.getVideoTitle(
    fakePage({ elements: { [NETFLIX_TITLE]: el("", {}, [el("The Studio"), el("E3"), el("Locked Out")]) } }),
    netflixUrl
  ),
  "The Studio · E3 · Locked Out"
);

assert.strictEqual(video.getVideoTitle(fakePage({ title: "Netflix" }), netflixUrl), "", "controls hidden");

navigator.mediaSession.metadata = { title: "Locked Out", artist: "The Studio" };
assert.strictEqual(
  video.getVideoTitle(fakePage({ title: "Netflix" }), netflixUrl),
  "Locked Out · The Studio",
  "media-session fallback"
);

console.log("✅ Video titles detected");