// tests/platforms.js
// Checks the platform registry and each adapter's id, captions and video.
// Run from cinemate-extension/:  node tests/platforms.js

const assert = require("assert");

require("../platforms/registry.js");
require("../platforms/youtube.js");
require("../platforms/netflix.js");
require("../platforms/primevideo.js");
const { platforms } = globalThis.CineMate;

const at = (href) => new URL(href);

// A fake document: `all` maps a selector to a list of fake elements.
function fakePage({ title = "", all = {} } = {}) {
  return {
    title,
    querySelector: (selector) => (all[selector] || [])[0] || null,
    querySelectorAll: (selector) => all[selector] || [],
  };
}
const el = (text) => ({ textContent: text, children: [], getAttribute: () => null });

// ---- Registry ----
assert.strictEqual(platforms.forHost("www.youtube.com").id, "youtube");
assert.strictEqual(platforms.forHost("m.youtube.com").id, "youtube");
assert.strictEqual(platforms.forHost("www.netflix.com").id, "netflix");
assert.strictEqual(platforms.forHost("notyoutube.com"), null, "only real subdomains match");
assert.strictEqual(platforms.forHost("example.com"), null);
assert.strictEqual(platforms.byId("netflix").icon, "🅽");
assert.throws(() => platforms.register({ id: "broken" }), /missing: label, hosts/);

// ---- Helpers ----
assert.strictEqual(platforms.helpers.slug("Season 1, Ep. 3 The Studio"), "season-1-ep-3-the-studio");
assert.strictEqual(platforms.helpers.slug("  "), "");

// ---- YouTube ----
const youtube = platforms.byId("youtube");
assert.strictEqual(youtube.getVideoId(at("https://www.youtube.com/watch?v=abc_123")), "abc_123");
assert.strictEqual(youtube.getVideoId(at("https://www.youtube.com/results?q=x")), null);
assert.strictEqual(
  youtube.readCaptions(fakePage({ all: { ".ytp-caption-segment": [el("Where were"), el("you?")] } })),
  "Where were you?"
);

// ---- Netflix ----
const netflix = platforms.byId("netflix");
assert.strictEqual(netflix.getVideoId(at("https://www.netflix.com/watch/81234567?t=10")), "81234567");
assert.strictEqual(
  netflix.readCaptions(fakePage({ all: { ".player-timedtext-text-container": [el("I told you.")] } })),
  "I told you."
);

// ---- Prime Video ----
const prime = platforms.byId("primevideo");
assert.strictEqual(platforms.forHost("www.primevideo.com").id, "primevideo");
assert.strictEqual(platforms.forHost("www.amazon.com").id, "primevideo");

// The player root (#dv-web-player) holds the title, episode, captions and videos.
function primePage({ title = "", episode = "", captions = [], videos = [] } = {}) {
  const inside = {
    ".atvwebplayersdk-title-text": title ? [el(title)] : [],
    ".atvwebplayersdk-subtitle-text": episode ? [el(episode)] : [],
    ".atvwebplayersdk-captions-text": captions.map(el),
    video: videos,
  };
  const player = {
    querySelector: (s) => (inside[s] || [])[0] || null,
    querySelectorAll: (s) => inside[s] || [],
  };
  return fakePage({ all: { "#dv-web-player": [player] } });
}

const detailUrl = at("https://www.primevideo.com/detail/0QTXL1X8SDAJ8NP4NDG0YB7TIQ/ref=atv_dp");

assert.strictEqual(prime.getVideoId(detailUrl, primePage()), null, "detail page, player not open");
assert.strictEqual(
  prime.getVideoId(detailUrl, primePage({ title: "The Studio", episode: "Season 1, Ep. 3 Locked Out" })),
  "0QTXL1X8SDAJ8NP4NDG0YB7TIQ-season-1-ep-3-locked-out",
  "episodes of one series get different ids"
);
assert.strictEqual(
  prime.getVideoId(at("https://www.amazon.com/gp/video/detail/B0ABCDEF12"), primePage({ title: "A Film" })),
  "B0ABCDEF12",
  "films: just the ASIN"
);
assert.strictEqual(
  prime.getTitle(primePage({ title: "The Studio", episode: "Season 1, Ep. 3 Locked Out" })),
  "The Studio · Season 1, Ep. 3 Locked Out"
);
assert.strictEqual(prime.readCaptions(primePage({ captions: ["Who locked", "the door?"] })), "Who locked the door?");

const trailer = { classList: { contains: (c) => c === "tst-video-overlay-player-html5" }, clientWidth: 1920, clientHeight: 1080 };
const film = { classList: { contains: () => false }, clientWidth: 1280, clientHeight: 720 };
assert.strictEqual(prime.getVideoElement(primePage({ videos: [trailer, film] })), film, "trailer ignored");

console.log("✅ Platform adapters work");