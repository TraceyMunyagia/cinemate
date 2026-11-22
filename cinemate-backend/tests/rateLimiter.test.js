// tests/rateLimiter.test.js  –  run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { createRateLimiter } = require("../services/rateLimiter");

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

const tooLong = (delay) => Object.assign(new Error("too long"), { delay });

test("lets requests through until the per-minute limit", async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ requestsPerMinute: 2, now: clock.now, sleep: clock.sleep });

  await limiter.acquire(0, tooLong);
  await limiter.acquire(0, tooLong);
  assert.strictEqual(limiter.delayForNext(), 60000);
});

test("queues a request when the wait is allowed", async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ requestsPerMinute: 1, now: clock.now, sleep: clock.sleep });

  await limiter.acquire(0, tooLong);
  clock.advance(55000);
  await limiter.acquire(10000, tooLong); // waits the remaining 5s
  assert.strictEqual(clock.now(), 60000);
});

test("fails fast when the wait is longer than allowed", async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ requestsPerMinute: 1, now: clock.now, sleep: clock.sleep });

  await limiter.acquire(0, tooLong);
  await assert.rejects(limiter.acquire(5000, tooLong), (error) => error.delay === 60000);
});

test("pauseFor blocks everything after a provider 429", async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ requestsPerMinute: 100, now: clock.now, sleep: clock.sleep });

  limiter.pauseFor(20000);
  assert.strictEqual(limiter.delayForNext(), 20000);
});