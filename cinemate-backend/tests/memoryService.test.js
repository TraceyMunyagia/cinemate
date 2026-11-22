// tests/memoryService.test.js  –  run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Use a throwaway folder instead of data/episode-memory.
process.env.EPISODE_MEMORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cinemate-memory-"));
const memoryService = require("../services/memoryService");

test("saves and loads a memory with its fingerprint", async () => {
  await memoryService.saveEpisodeMemory("youtube-AbC", { summary: "upper" }, { fingerprint: "f1" });
  const record = await memoryService.getEpisodeMemory("youtube-AbC");

  assert.strictEqual(record.episodeId, "youtube-AbC");
  assert.strictEqual(record.fingerprint, "f1");
  assert.strictEqual(record.episodeMemory.summary, "upper");
});

test("YouTube ids that differ only by case don't overwrite each other", async () => {
  await memoryService.saveEpisodeMemory("youtube-abc", { summary: "lower" });

  assert.notStrictEqual(memoryService.fileNameFor("youtube-abc"), memoryService.fileNameFor("youtube-AbC"));
  assert.strictEqual((await memoryService.getEpisodeMemory("youtube-AbC")).episodeMemory.summary, "upper");
  assert.strictEqual((await memoryService.getEpisodeMemory("youtube-abc")).episodeMemory.summary, "lower");
});

test("lists every saved memory", async () => {
  const list = await memoryService.listEpisodeMemories();
  assert.deepStrictEqual(list.map((item) => item.episodeId).sort(), ["youtube-AbC", "youtube-abc"]);
});

test("returns null for an unknown episode", async () => {
  assert.strictEqual(await memoryService.getEpisodeMemory("netflix-nope"), null);
});