// services/summarizer.js
// Builds an episode memory from subtitles.
// Short episodes: one AI call. Long ones: summarise each section, then merge
// the section memories (map → reduce), so the whole episode is covered.

const config = require("../config");
const chunkingService = require("./chunkingService");
const defaultAi = require("./aiService");
const { extractJson, entrySeconds } = require("../utils/formatter");
const { buildEpisodePrompt, buildMergePrompt } = require("../prompts/episodePrompt");
const { HttpError } = require("../utils/validators");

const MAX_SECTIONS = 8;
const MIN_SECTION_CHARS = 16000;

const asArray = (value) => (Array.isArray(value) ? value : []);

// Map of chunk index -> chunk summary, read from the AI's "subtitleChunks".
function chunkSummaryMap(memory) {
  const map = new Map();
  for (const item of asArray(memory?.subtitleChunks)) {
    if (Number.isInteger(item?.index)) map.set(item.index, String(item.summary || ""));
  }
  return map;
}

function normalizeEpisodeMemory(memory, chunks, summaries = chunkSummaryMap(memory)) {
  return {
    summary: String(memory?.summary || ""),
    characters: asArray(memory?.characters),
    importantEvents: asArray(memory?.importantEvents),
    keyThemes: asArray(memory?.keyThemes),
    emotionalMoments: asArray(memory?.emotionalMoments),
    majorConflicts: asArray(memory?.majorConflicts),
    importantCharacterActions: asArray(memory?.importantCharacterActions),
    subtitleChunks: chunks.map(({ text, ...chunk }) => ({
      ...chunk,
      summary: summaries.get(chunk.index) || "",
    })),
  };
}

// What part of the episode this memory is based on (used for caching and
// for keeping spoilers out of chat).
function describeCoverage(subtitles, chunks, sectionCount) {
  const last = subtitles[subtitles.length - 1];

  return {
    lineCount: subtitles.length,
    startTime: chunks[0]?.startTime || "00:00:00",
    endTime: chunks[chunks.length - 1]?.endTime || "00:00:00",
    endSeconds: entrySeconds(last),
    sections: sectionCount,
  };
}

function buildMockEpisodeMemory(subtitles, chunks) {
  const recent = subtitles.slice(-5).map((s) => s.text).filter(Boolean);

  return {
    summary: `Mock summary of ${subtitles.length} subtitle lines (${chunks[0].startTime}–${chunks[chunks.length - 1].endTime}). Recent dialogue: ${recent.join(" ")}`,
    characters: [],
    importantEvents: [
      { time: subtitles[0]?.time || "00:00:00", description: "Mock event based on captured subtitle flow." },
    ],
    keyThemes: ["Mock theme"],
    emotionalMoments: [],
    majorConflicts: [],
    importantCharacterActions: [],
    subtitleChunks: chunks.map(({ text, ...chunk }) => ({ ...chunk, summary: "Mock chunk summary." })),
  };
}

function createSummarizer({ ai = defaultAi, useMock = config.useMockAi } = {}) {
  async function summarizeSections(sections) {
    const parts = [];

    // One at a time, so the rate limiter can space the calls out.
    for (const section of sections) {
      const prompt = buildEpisodePrompt(section.chunks, {
        part: section.index + 1,
        totalParts: sections.length,
      });
      const memory = extractJson(await ai.generateStructured(prompt));
      parts.push({ section, memory });
    }

    return parts;
  }

  async function buildEpisodeMemory(subtitles) {
    const chunks = chunkingService.buildSubtitleChunks(subtitles);

    if (chunks.length === 0) {
      throw new HttpError(400, "No usable subtitle text found.");
    }

    const sections = chunkingService.groupIntoSections(chunks, {
      maxSections: MAX_SECTIONS,
      minSectionChars: MIN_SECTION_CHARS,
    });
    const coverage = describeCoverage(subtitles, chunks, sections.length);

    if (useMock) {
      return { mock: true, episodeMemory: { ...buildMockEpisodeMemory(subtitles, chunks), coverage } };
    }

    // Short episode: a single call, like before.
    if (sections.length === 1) {
      const raw = await ai.generateStructured(buildEpisodePrompt(chunks));
      const memory = normalizeEpisodeMemory(extractJson(raw), chunks);
      return { mock: false, episodeMemory: { ...memory, coverage } };
    }

    // Long episode: map each section, then reduce.
    const parts = await summarizeSections(sections);

    const chunkSummaries = new Map();
    parts.forEach(({ memory }) => {
      chunkSummaryMap(memory).forEach((summary, index) => chunkSummaries.set(index, summary));
    });

    const mergeInput = parts.map(({ section, memory }) => {
      const { subtitleChunks, ...rest } = memory || {};
      return { part: section.index + 1, startTime: section.startTime, endTime: section.endTime, ...rest };
    });

    const merged = extractJson(await ai.generateStructured(buildMergePrompt(mergeInput)));
    const memory = normalizeEpisodeMemory(merged, chunks, chunkSummaries);

    return { mock: false, episodeMemory: { ...memory, coverage } };
  }

  return { buildEpisodeMemory };
}

module.exports = { ...createSummarizer(), createSummarizer };