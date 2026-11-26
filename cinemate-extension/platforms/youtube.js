// platforms/youtube.js
(function (root) {
  const { register, helpers } = root.CineMate.platforms;

  register({
    id: "youtube",
    label: "YouTube",
    icon: "▶️",
    hosts: ["youtube.com"],

    getVideoId(url) {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const shorts = url.pathname.match(/^\/shorts\/([\w-]+)/);
      return shorts ? shorts[1] : null;
    },

    // YouTube keeps the previous video's heading on screen for a moment after
    // switching videos. <ytd-watch-flexy video-id="..."> says which video the
    // page currently shows, so only trust the heading when it matches.
    getTitle(doc, url) {
      const id = this.getVideoId(url);
      const pageVideoId = doc.querySelector("ytd-watch-flexy")?.getAttribute("video-id");
      if (pageVideoId && pageVideoId !== id) return ""; // still showing the old video

      const heading = doc.querySelector("h1.ytd-watch-metadata yt-formatted-string");
      const text = heading?.textContent?.trim();
      if (text) return text;

      const fromTab = String(doc.title || "")
        .replace(/^\(\d+\)\s*/, "")
        .replace(/\s*-\s*YouTube$/, "")
        .trim();
      return (fromTab && fromTab !== "YouTube" ? fromTab : "") || helpers.mediaSessionTitle();
    },

    readCaptions(doc) {
      return helpers.textOf(doc, ".ytp-caption-segment");
    },
  });
})(globalThis);