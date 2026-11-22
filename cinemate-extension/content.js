// content.js
// Runs on YouTube and Netflix. Detects the current video, captures its
// captions into a per-video session and shows the CineMate button.
// Depends on utils/*.js, which the manifest loads first.

(function () {
  const { time, captions, storage, video: videoInfo } = globalThis.CineMate;

  const CAPTURE_INTERVAL_MS = 1000;
  const SAVE_DELAY_MS = 2000;

  const CAPTION_SELECTORS = {
    youtube: ".ytp-caption-segment",
    netflix: ".player-timedtext-text-container",
  };

  let session = null; // { videoId, platform, title, url } for the video on screen
  let tracker = null; // caption tracker for that video
  let dirty = false; // unsaved caption changes
  let saveTimer = null;
  let syncing = null; // in-flight syncSession() promise
  let button = null;
  let intervalId = null;

  console.log("🎬 CineMate content script running");

  // ---------- Captions ----------

  function readCaptionText() {
    if (!session) return "";
    const selector = CAPTION_SELECTORS[session.platform];
    if (!selector) return "";

    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.textContent.trim())
      .filter(Boolean)
      .join(" ");
  }

  // ---------- Saving ----------

  function scheduleSave() {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(flush, SAVE_DELAY_MS);
  }

  async function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;

    if (!dirty || !session || !tracker) return;
    dirty = false;

    try {
      await storage.saveSubtitles(session, tracker.entries);
    } catch (error) {
      console.warn("CineMate could not save captions:", error);
      dirty = true;
    }
  }

  // ---------- Sessions ----------

  // Start a new session whenever the video in the URL changes.
  function syncSession() {
    if (!syncing) {
      syncing = doSyncSession().finally(() => {
        syncing = null;
      });
    }
    return syncing;
  }

  async function doSyncSession() {
    const current = videoInfo.getCurrentVideo();
    const currentId = current?.videoId || null;

    if (currentId === (session?.videoId || null)) {
      refreshTitle(current);
      return;
    }

    await flush(); // save the previous video before switching

    if (!current) {
      session = null;
      tracker = null;
      updateButton();
      return;
    }

    // Resume if this video was captured before.
    const entries = await storage.getSubtitles(current.videoId);
    session = current;
    tracker = captions.createTracker(entries);

    await storage.setActiveVideo(session);
    updateButton();

    console.log(`🎞️ CineMate session: ${session.videoId} (${entries.length} saved lines)`);
  }

  // Titles often load after the URL changes, so keep them up to date.
  function refreshTitle(current) {
    if (!session || !current?.title || current.title === session.title) return;
    session = { ...session, title: current.title };
    storage.setActiveVideo(session);
    scheduleSave();
  }

  async function activateSession() {
    await syncSession();
    if (!session) return false;
    await flush();
    await storage.setActiveVideo(session);
    return true;
  }

  // ---------- Capture loop ----------

  async function tick() {
    // After the extension is reloaded, this old script can't talk to Chrome.
    if (!chrome.runtime?.id) {
      shutDown();
      return;
    }

    await syncSession();
    if (!session || !tracker) return;

    const changed = tracker.push(readCaptionText(), time.getPlaybackSeconds());
    if (changed) scheduleSave();
  }

  function shutDown() {
    clearInterval(intervalId);
    button?.remove();
    console.log("CineMate was reloaded – refresh this tab to reconnect.");
  }

  // ---------- Floating button ----------

  function createButton() {
    if (document.getElementById("cinemate-floating-btn")) {
      return document.getElementById("cinemate-floating-btn");
    }

    const btn = document.createElement("button");
    btn.id = "cinemate-floating-btn";
    btn.innerText = "🎬";
    btn.title = "Open CineMate";
    Object.assign(btn.style, {
      position: "fixed",
      bottom: "32px",
      right: "32px",
      width: "64px",
      height: "64px",
      borderRadius: "50%",
      background: "#7C3AED",
      color: "white",
      fontSize: "32px",
      border: "none",
      boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
      zIndex: "999999",
      cursor: "pointer",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
    });

    btn.addEventListener("click", async () => {
      await activateSession();
      chrome.runtime.sendMessage({ action: "openDiscussionPanel" });
    });

    document.body.appendChild(btn);
    return btn;
  }

  // Only show the button on actual watch pages.
  function updateButton() {
    if (button) button.style.display = session ? "flex" : "none";
  }

  // ---------- Events ----------

  // Toolbar icon clicked on this tab -> make this video the active one.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== "activateSession") return;
    activateSession().then((ok) => sendResponse({ ok }));
    return true; // keep the channel open for the async reply
  });

  // Captions cleared from the panel -> forget them here too.
  storage.watch((changes) => {
    if (!session || !tracker) return;
    const change = changes[storage.subtitleKey(session.videoId)];
    if (change && change.newValue === undefined) {
      tracker.reset([]);
      dirty = false;
    }
  });

  // YouTube changes videos without reloading the page.
  document.addEventListener("yt-navigate-finish", () => syncSession());

  // Coming back to this tab makes its video the active one again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && session) {
      storage.setActiveVideo(session);
    }
  });

  window.addEventListener("pagehide", flush);

  // ---------- Start ----------

  storage.removeLegacyData();
  button = createButton();
  intervalId = setInterval(tick, CAPTURE_INTERVAL_MS);
  syncSession();

  // Debugging: pick "CineMate AI" in the DevTools console's context dropdown.
  globalThis.CineMate.debug = {
    readCaptionText,
    getSession: () => session,
    getEntries: () => tracker?.entries || [],
  };
})();