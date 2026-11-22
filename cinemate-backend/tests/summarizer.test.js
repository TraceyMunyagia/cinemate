// tests/summarizer.test.js  –  run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { createSummarizer } = require("../services/summarizer");
const { secondsToTime } = require("../utils/formatter");

// ~3 hours of dialogue, one line every 4 seconds.
function makeSubtitles(count) {
  return Array.from({ length: count }, (_, i) => ({
    time: secondsToTime(i * 4),
    seconds: i * 4,
    text: `Line number ${i} where something happens in the story right now.`,
  }));
}

// Fake AI: answers section prompts with a summary for every chunk index it
// was given, and records every prompt it sees.
function fakeAi() {
  const prompts = [];
  return {
    prompts,
    async generateStructured(prompt) {
      prompts.push(prompt);
      const indexes = [...prompt.matchAll(/"index": (\d+)/g)].map((m) => Number(m[1]));
      return JSON.stringify({
        summary: prompt.includes("Merge the part memories") ? "Whole episode" : "Part",
        keyThemes: ["trust"],
        subtitleChunks: indexes.map((index) => ({ index, summary: `chunk ${index}` })),
      });
    },
  };
}

test("a short episode is summarised in one call", async () => {
  const ai = fakeAi();
  const { episodeMemory } = await createSummarizer({ ai, useMock: false }).buildEpisodeMemory(makeSubtitles(100));

  assert.strictEqual(ai.prompts.length, 1);
  assert.strictEqual(episodeMemory.coverage.sections, 1);
  assert.ok(episodeMemory.subtitleChunks.every((chunk) => chunk.summary.startsWith("chunk ")));
});

test("a long episode is summarised section by section, then merged", async () => {
  const ai = fakeAi();
  const subtitles = makeSubtitles(2700);
  const { episodeMemory } = await createSummarizer({ ai, useMock: false }).buildEpisodeMemory(subtitles);

  const sections = episodeMemory.coverage.sections;
  assert.ok(sections > 1 && sections <= 8, `sections = ${sections}`);
  assert.strictEqual(ai.prompts.length, sections + 1, "one call per section + one merge");
  assert.strictEqual(episodeMemory.summary, "Whole episode");

  // The last line of the episode reached the AI (the old cap dropped it).
  assert.ok(ai.prompts.some((p) => p.includes("Line number 2699 ")));
  assert.strictEqual(episodeMemory.coverage.endTime, secondsToTime(2699 * 4));
  assert.strictEqual(episodeMemory.coverage.lineCount, 2700);

  // Chunk summaries from every section were kept.
  assert.ok(episodeMemory.subtitleChunks.every((chunk) => chunk.summary === `chunk ${chunk.index}`));
});

test("mock mode makes no AI calls", async () => {
  const ai = fakeAi();
  const result = await createSummarizer({ ai, useMock: true }).buildEpisodeMemory(makeSubtitles(50));

  assert.strictEqual(result.mock, true);
  assert.strictEqual(ai.prompts.length, 0);
  assert.strictEqual(result.episodeMemory.coverage.lineCount, 50);
});

test("rejects subtitles with no text", async () => {
  await assert.rejects(
    createSummarizer({ ai: fakeAi(), useMock: false }).buildEpisodeMemory([{ time: "00:00:01", text: " " }]),
    /No usable subtitle text/
  );
});