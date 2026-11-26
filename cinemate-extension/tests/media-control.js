// tests/media-control.js
// Checks pausing / turning down the video while you talk.
// Run from cinemate-extension/:  node tests/media-control.js

const assert = require("assert");

require("../utils/mediaControl.js");
const { media } = globalThis.CineMate;

function fakeVideo({ paused = false, volume = 0.8 } = {}) {
  return {
    paused,
    volume,
    pause() {
      this.paused = true;
    },
    play() {
      this.paused = false;
      return Promise.resolve();
    },
  };
}

// Timers the test fires by hand.
function fakeTimers() {
  let pending = null;
  return {
    setTimer: (fn) => (pending = fn),
    clearTimer: () => (pending = null),
    fire: () => pending?.(),
  };
}

// ---- pause, then resume ----
let video = fakeVideo();
let timers = fakeTimers();
let controller = media.createMediaController({ getVideo: () => video, ...timers });

controller.hold("pause");
assert.strictEqual(video.paused, true);
controller.release();
assert.strictEqual(video.paused, false, "resumed because we paused it");

// ---- a video that was already paused stays paused ----
video = fakeVideo({ paused: true });
controller = media.createMediaController({ getVideo: () => video, ...fakeTimers() });
controller.hold("pause");
controller.release();
assert.strictEqual(video.paused, true, "we didn't pause it, so we don't play it");

// ---- if you press play yourself while CineMate talks, nothing changes on release ----
video = fakeVideo();
controller = media.createMediaController({ getVideo: () => video, ...fakeTimers() });
controller.hold("pause");
video.play();
controller.release();
assert.strictEqual(video.paused, false);

// ---- duck, then restore ----
video = fakeVideo({ volume: 0.8 });
controller = media.createMediaController({ getVideo: () => video, ...fakeTimers() });
controller.hold("duck");
assert.strictEqual(video.volume, 0.15);
assert.strictEqual(video.paused, false, "ducking doesn't pause");
controller.release();
assert.strictEqual(video.volume, 0.8);

// ---- if you change the volume while ducked, we leave your volume alone ----
video = fakeVideo({ volume: 0.8 });
controller = media.createMediaController({ getVideo: () => video, ...fakeTimers() });
controller.hold("duck");
video.volume = 0.5;
controller.release();
assert.strictEqual(video.volume, 0.5);

// ---- holding twice (talk → reply) keeps the first hold ----
video = fakeVideo();
controller = media.createMediaController({ getVideo: () => video, ...fakeTimers() });
controller.hold("pause");
assert.deepStrictEqual(controller.hold("duck"), { holding: true, mode: "pause" });
controller.release();
assert.strictEqual(video.paused, false);

// ---- safety timer lets go if the panel never releases ----
video = fakeVideo();
timers = fakeTimers();
controller = media.createMediaController({ getVideo: () => video, ...timers });
controller.hold("pause");
timers.fire();
assert.strictEqual(video.paused, false, "released by the safety timer");
assert.deepStrictEqual(controller.state(), { holding: false, mode: null });

// ---- "off", or no video on the page, does nothing ----
video = fakeVideo();
controller = media.createMediaController({ getVideo: () => video, ...fakeTimers() });
assert.deepStrictEqual(controller.hold("off"), { holding: false, mode: null });
assert.strictEqual(video.paused, false);

controller = media.createMediaController({ getVideo: () => null, ...fakeTimers() });
assert.deepStrictEqual(controller.hold("pause"), { holding: false, mode: null });

console.log("✅ Video pause / duck works");