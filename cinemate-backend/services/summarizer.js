const chunkingService = require("./chunkingService");
const geminiService = require("./geminiService");
const { extractJson } = require("../utils/formatter");
const { buildEpisodePrompt } = require("../prompts/episodePrompt");
const { HttpError } = require("../utils/validators");

const USE_MOCK_AI = process.env.USE_MOCK_AI === "true";

function normalizeEpisodeMemory(memory, chunks) {
  return {
    summary: String(memory.summary || ""),
    characters: Array.isArray(memory.characters) ? memory.characters : [],
    importantEvents: Array.isArray(memory.importantEvents)
      ? memory.importantEvents
      : [],
    keyThemes: Array.isArray(memory.keyThemes) ? memory.keyThemes : [],
    emotionalMoments: Array.isArray(memory.emotionalMoments)
      ? memory.emotionalMoments
      : [],
    majorConflicts: Array.isArray(memory.majorConflicts)
      ? memory.majorConflicts
      : [],
    importantCharacterActions: Array.isArray(memory.importantCharacterActions)
      ? memory.importantCharacterActions
      : [],
    subtitleChunks: chunks.map(({ text, ...chunk }) => ({
      ...chunk,
      summary: memory.subtitleChunks?.[chunk.index]?.summary || "",
    })),
  };
}

function buildMockEpisodeMemory(subtitles, chunks) {
  const sampleLines = subtitles.slice(-5).map((s) => s.text).filter(Boolean);
  const summary =
    sampleLines.length > 0
      ? `Mock summary generated from ${subtitles.length} captured subtitle entries. Recent dialogue: ${sampleLines.join(" ")}`
      : "Mock summary generated without subtitle text.";

  return {
    summary,
    characters: [],
    importantEvents: [
      {
        time: subtitles[0]?.time || "00:00:00",
        description: "Mock event based on captured subtitle flow.",
      },
    ],
    keyThemes: ["Mock theme"],
    emotionalMoments: [],
    majorConflicts: [],
    importantCharacterActions: [],
    subtitleChunks: chunks.map(({ text, ...chunk }) => ({
      ...chunk,
      summary: "Mock chunk summary.",
    })),
  };
}

async function buildEpisodeMemory(subtitles) {
  const subtitleChunks = chunkingService.buildSubtitleChunks(subtitles);

  if (subtitleChunks.length === 0) {
    throw new HttpError(400, "No usable subtitle text found.");
  }

  if (USE_MOCK_AI) {
    return {
      mock: true,
      episodeMemory: buildMockEpisodeMemory(subtitles, subtitleChunks),
    };
  }

  const prompt = buildEpisodePrompt(subtitleChunks);
  const rawMemory = await geminiService.generateStructured(prompt);
  const episodeMemory = normalizeEpisodeMemory(extractJson(rawMemory), subtitleChunks);

  return { mock: false, episodeMemory };
}

module.exports = { buildEpisodeMemory };
