// platforms/netflix.js
(function (root) {
  const { register, helpers } = root.CineMate.platforms;

  register({
    id: "netflix",
    label: "Netflix",
    icon: "🅽",
    hosts: ["netflix.com"],

    getVideoId(url) {
      const watch = url.pathname.match(/^\/watch\/(\d+)/);
      return watch ? watch[1] : null;
    },

    // "Show · E3 · Episode name" – only shown while the player controls are
    // visible, so the content script keeps whatever it found last.
    getTitle(doc) {
      const titleEl = doc.querySelector('[data-uia="video-title"]');

      if (titleEl) {
        const parts = Array.from(titleEl.children)
          .map((child) => child.textContent.trim())
          .filter(Boolean);

        const text = parts.length > 0 ? parts.join(" · ") : titleEl.textContent.trim();
        if (text) return text;
      }

      return helpers.mediaSessionTitle();
    },

    readCaptions(doc) {
      return helpers.textOf(doc, ".player-timedtext-text-container");
    },
  });
})(globalThis);