// services/rateLimiter.js
// Keeps CineMate under the provider's requests-per-minute limit.
// Requests that would go over wait their turn; if the wait is longer than
// the caller allows, it fails fast with a 429 the panel can show.

function createRateLimiter({ requestsPerMinute, windowMs = 60000, now = Date.now, sleep }) {
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const starts = []; // start times of recent (and already-queued) requests
  let blockedUntil = 0; // set when the provider itself says "slow down"

  // How long until the next request may start. Doesn't reserve anything.
  function delayForNext() {
    const t = now();

    while (starts.length > 0 && starts[0] <= t - windowMs) starts.shift();

    let at = t;
    if (starts.length >= requestsPerMinute) {
      at = Math.max(at, starts[starts.length - requestsPerMinute] + windowMs);
    }
    at = Math.max(at, blockedUntil);

    return at - t;
  }

  // Waits for a free slot. Throws onTooLong(delayMs) if it would take longer than maxWaitMs.
  async function acquire(maxWaitMs, onTooLong) {
    const delay = delayForNext();

    if (delay > maxWaitMs) {
      throw onTooLong(delay);
    }

    starts.push(now() + delay);
    if (delay > 0) await wait(delay);
  }

  // The provider returned a 429 – hold every request until this time.
  function pauseFor(ms) {
    blockedUntil = Math.max(blockedUntil, now() + ms);
  }

  return { acquire, pauseFor, delayForNext };
}

module.exports = { createRateLimiter };