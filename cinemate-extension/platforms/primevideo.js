// platforms/primevideo.js
// Prime Video (primevideo.com and amazon.com/gp/video).
//
// The player lives in #dv-web-player. Captions are in
// .atvwebplayersdk-captions-text, and the title / episode in
// .atvwebplayersdk-title-text / .atvwebplayersdk-subtitle-text.
// The detail page also autoplays a trailer in a second <video> with the
// class "tst-video-overlay-player-html5" – that one is ignored.
//
// All episodes of a series share one page URL, so the episode line becomes
// part of the id: "primevideo-<ASIN>-season-1-ep-3-the-studio".
// No title on screen = the player isn't open yet = not watching (no session).

(function (root) {
  const { register, helpers } = root.CineMate.platforms;

  const PLAYER = "#dv-web-player";
  const TITLE = ".atvwebplayersdk-title-text";
  const EPISODE = ".atvwebplayersdk-subtitle-text";
  const CAPTIONS = ".atvwebplayersdk-captions-text";
  const TRAILER_CLASS = "tst-video-overlay-player-html5";

  // /detail/<ASIN>/..., /dp/<ASIN>, /gp/video/detail/<ASIN>, or ?gti=...
  function getAsin(url) {
    const match = url.pathname.match(/\/(?:detail|dp)\/([A-Za-z0-9]{8,})/);
    return match ? match[1] : url.searchParams.get("gti");
  }

  const playerText = (doc, selector) => helpers.textOf(doc?.querySelector?.(PLAYER), selector);

  register({
    id: "primevideo",
    label: "Prime Video",
    icon: "🅿️",
    hosts: ["primevideo.com", "amazon.com"],

    getVideoId(url, doc) {
      const title = playerText(doc, TITLE);
      if (!title) return null; // player not open – just browsing

      const episode = helpers.slug(playerText(doc, EPISODE));
      const base = getAsin(url) || helpers.slug(title);
      return episode ? `${base}-${episode}` : base;
    },

    getTitle(doc) {
      const title = playerText(doc, TITLE);
      const episode = playerText(doc, EPISODE);
      return [title, episode].filter(Boolean).join(" · ") || helpers.mediaSessionTitle();
    },

    readCaptions(doc) {
      return playerText(doc, CAPTIONS);
    },

    getVideoElement(doc) {
      const player = doc?.querySelector?.(PLAYER);
      return helpers.biggestVideo(player, (video) => !video.classList?.contains(TRAILER_CLASS));
    },
  });
})(globalThis);