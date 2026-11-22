// tests/summarizeController.test.js  –  run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.EPISODE_MEMORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cinemate-summaries-"));

// Swap the real summarizer for a fake that counts how often it runs.
let builds = 0;
const summarizerPath = require.resolve("../services/summarizer");
require.cache[summarizerPath] = {
  id: summarizerPath,
  filename: summarizerPath,
  loaded: true,
  exports: {
    async buildEpisodeMemory(subtitles) {
      builds++;
      const last = subtitles[subtitles.length - 1];
      return {
        mock: false,
        episodeMemory: {
          summary: `Summary of ${subtitles.length} lines`,
          coverage: { endSeconds: last.seconds, endTime: last.time },
        },
      };
    },
  },
};

const { summarize } = require("../controllers/summarizeController");

// Calls the controller like Express would and returns { status, body }.
function call(body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, body: data }); },
    };
    summarize({ body }, res, (error) => resolve({ status: error.status || 500, body: { error: error.message } }));
  });
}

const subtitles = [
  { time: "00:01:00", seconds: 60, text: "One" },
  { time: "00:02:00", seconds: 120, text: "Two" },
  { time: "00:30:00", seconds: 1800, text: "Big twist" },
];

test("only summarises up to the viewer's position", async () => {
  const { body } = await call({ subtitles, episodeId: "netflix-9", currentSeconds: 150 });
  assert.strictEqual(body.summary, "Summary of 2 lines");
  assert.strictEqual(body.cached, false);
});

test("the same captions again come from the cache", async () => {
  const before = builds;
  const { body } = await call({ subtitles, episodeId: "netflix-9", currentSeconds: 160 });
  assert.strictEqual(body.cached, true);
  assert.strictEqual(builds, before, "no new AI work");
});

test("new captions or force=true rebuild the summary", async () => {
  const more = await call({ subtitles, episodeId: "netflix-9", currentSeconds: 1900 });
  assert.strictEqual(more.body.cached, false);
  assert.strictEqual(more.body.summary, "Summary of 3 lines");

  const forced = await call({ subtitles, episodeId: "netflix-9", currentSeconds: 1900, force: true });
  assert.strictEqual(forced.body.cached, false);
});

test("nothing before the viewer's position is a clear 400", async () => {
  const { status, body } = await call({ subtitles, currentSeconds: 10 });
  assert.strictEqual(status, 400);
  assert.match(body.error, /No captions before/);
});