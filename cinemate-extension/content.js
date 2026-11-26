// content.js
// Runs on YouTube and Netflix. Detects the current video, captures its
// captions into a per-video session and shows the CineMate button.
// Depends on utils/*.js, which the manifest loads first.

(function () {
  const { captions, storage, video: videoInfo, media } = globalThis.CineMate;
  const CAPTURE_INTERVAL_MS = 1000;
  const SAVE_DELAY_MS = 2000;
  const NO_CAPTIONS_AFTER_SECONDS = 45; // played this long with no captions → tell the panel


  let session = null; // { videoId, platform, title, url } for the video on screen
  let tracker = null; // caption tracker for that video
  let dirty = false; // unsaved caption changes
  let saveTimer = null;
  let syncing = null; // in-flight syncSession() promise
  let button = null;
  let intervalId = null;
  let stopped = false; // set once the extension is reloaded under this tab
  let tabId = null; // this tab's id, so the panel can ask for the playback time
  let playedSeconds = 0; // how long this video has played in this tab
  let sawCaptions = false; // any caption text seen for this video in this tab

  // Pauses / turns down the video while you talk to CineMate.
  console.log("🎬 CineMate content script running");

  // ---------- Captions ----------

   // Each platform adapter knows where its captions are.
  function readCaptionText() {
    return session ? videoInfo.readCaptions() : "";
  }

    function getPlaybackSeconds() {
    return videoInfo.getVideoElement()?.currentTime || 0;
  }

  function isPlaying() {
    const video = videoInfo.getVideoElement();
    return Boolean(video && !video.paused);
  }

  // "ok" once captions have appeared; "missing" after 45s of playing without any.
  function captionStatus() {
    if (sawCaptions) return "ok";
    return playedSeconds >= NO_CAPTIONS_AFTER_SECONDS ? "missing" : "waiting";
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
      dirty = true;
      onBackgroundError(error);
    }
  }

  // ---------- Sessions ----------

  async function getTabId() {
    if (tabId !== null) return tabId;

    try {
      const reply = await chrome.runtime.sendMessage({ action: "whoAmI" });
      tabId = reply?.tabId ?? null;
    } catch {
      tabId = null;
    }

    return tabId;
  }
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
    mediaController.release(); // never leave the old video paused or quiet

    if (!current) {
      session = null;
      tracker = null;
      updateButton();
      return;
    }

    // Resume if this video was captured before.
    // Resume if this video was captured before – including its title, since
    // Netflix only shows the title while the player controls are visible.
    const entries = await storage.getSubtitles(current.videoId);
    const saved = await storage.getSession(current.videoId);
    session = {
      ...current,
      title: current.title || saved?.title || "",
      tabId: await getTabId(),
    };
     playedSeconds = 0;
    sawCaptions = false;
    tracker = captions.createTracker(entries);

    await storage.setActiveVideo(session);
    updateButton();

    console.log(`🎞️ CineMate session: ${session.videoId} (${entries.length} saved lines)`);
  }

  // Titles often load after the URL changes, so keep them up to date.
  function refreshTitle(current) {
    if (!session || !current?.title || current.title === session.title) return;
    session = { ...session, title: current.title };
    storage.setActiveVideo(session).catch(onBackgroundError);
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

    try {
      await syncSession();
    } catch (error) {
      onBackgroundError(error);
      return;
    }
    if (!session || !tracker) return;

        const text = readCaptionText();
    if (text) sawCaptions = true;
    if (isPlaying()) playedSeconds += CAPTURE_INTERVAL_MS / 1000;

    const changed = tracker.push(text, getPlaybackSeconds());
    if (changed) scheduleSave();
  }

  // Fire-and-forget storage calls end up here. A reloaded extension throws
  // "Extension context invalidated" – that just means this tab is stale.
  function onBackgroundError(error) {
    if (!chrome.runtime?.id || /context invalidated/i.test(error?.message || "")) {
      shutDown();
    } else {
      console.warn("CineMate:", error);
    }
  }

  function shutDown() {
    if (stopped) return;
    stopped = true;
    clearInterval(intervalId);
    clearTimeout(saveTimer);
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
      try {
        await activateSession();
        await chrome.runtime.sendMessage({ action: "openDiscussionPanel" });
      } catch (error) {
        onBackgroundError(error);
      }
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
    // Toolbar icon clicked on this tab -> make this video the active one.
    if (message.action === "activateSession") {
      activateSession().then((ok) => sendResponse({ ok }));
      return true; // keep the channel open for the async reply
    }


    // The panel pausing / turning down the video while you talk.
    if (message.action === "media") {
      const state =
        message.command === "hold" ? mediaController.hold(message.mode) : mediaController.release();
      sendResponse({ videoId: session?.videoId || null, ...state });
      return;
    }
    // The panel asking where the viewer is (spoiler guard).
       if (message.action === "getPlayback") {
      const video = videoInfo.getVideoElement();
           sendResponse({
        videoId: session?.videoId || null,
        platform: session?.platform || null,
        seconds: video ? video.currentTime : null,
        paused: video ? video.paused : true,
        captions: captionStatus(),
      });
    }
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
  document.addEventListener("yt-navigate-finish", () => {
    if (!stopped) syncSession().catch(onBackgroundError);
  });

  // Coming back to this tab makes its video the active one again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && session && !stopped) {
      storage.setActiveVideo(session).catch(onBackgroundError);
    }
  });

  window.addEventListener("pagehide", () => {
    if (!stopped) flush();
  });

  // ---------- Start ----------

  Promise.resolve(storage.removeLegacyData()).catch(onBackgroundError);
  button = createButton();
  intervalId = setInterval(tick, CAPTURE_INTERVAL_MS);
  syncSession().catch(onBackgroundError);

  // Debugging: pick "CineMate AI" in the DevTools console's context dropdown.
  globalThis.CineMate.debug = {
    readCaptionText,
    getSession: () => session,
    getEntries: () => tracker?.entries || [],
  };
})();