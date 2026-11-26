// utils/mediaControl.js
// Pauses or turns down the video while you talk to CineMate, then puts it
// back exactly as it was. Runs in the content script.
//
//   hold("pause") – pause, but only if it was playing
//   hold("duck")  – lower the volume
//   release()     – undo whatever hold() did (and nothing else)
//
// If the panel closes mid-conversation, the hold lets go by itself after
// maxHoldMs so the video never stays paused or quiet by accident.

(function (root) {
  const CineMate = (root.CineMate = root.CineMate || {});

  function createMediaController({
    getVideo,
    duckVolume = 0.15,
    maxHoldMs = 120000,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    let held = null; // { video, mode, pausedByUs, savedVolume, duckedTo }
    let safetyTimer = null;

    function state() {
      return { holding: Boolean(held), mode: held?.mode || null };
    }

    function armSafetyTimer() {
      clearTimer(safetyTimer);
      safetyTimer = setTimer(release, maxHoldMs);
    }

    function hold(mode) {
      if (mode !== "pause" && mode !== "duck") return state();

      const video = getVideo();
      if (!video) return state();

      // Already holding (e.g. you spoke, now CineMate answers): keep it, reset the timer.
      if (held) {
        armSafetyTimer();
        return state();
      }

      held = { video, mode, pausedByUs: false, savedVolume: null, duckedTo: null };

      if (mode === "pause" && !video.paused) {
        video.pause();
        held.pausedByUs = true;
      }

      if (mode === "duck" && video.volume > duckVolume) {
        held.savedVolume = video.volume;
        held.duckedTo = duckVolume;
        video.volume = duckVolume;
      }

      armSafetyTimer();
      return state();
    }

    function release() {
      clearTimer(safetyTimer);
      safetyTimer = null;
      if (!held) return state();

      const { video, pausedByUs, savedVolume, duckedTo } = held;
      held = null;

      // Only resume if we paused it and you haven't pressed play yourself.
      if (pausedByUs && video.paused) {
        const playing = video.play();
        if (playing?.catch) playing.catch(() => {});
      }

      // Only restore the volume if you haven't changed it meanwhile.
      if (savedVolume !== null && Math.abs(video.volume - duckedTo) < 0.01) {
        video.volume = savedVolume;
      }

      return state();
    }

    return { hold, release, state };
  }

  CineMate.media = { createMediaController };
})(globalThis);