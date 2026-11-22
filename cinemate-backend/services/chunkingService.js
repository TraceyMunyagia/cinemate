// services/chunkingService.js
// Splits a whole episode's subtitles into small chunks (~1,200 chars) and
// groups those chunks into a few large sections for the AI to summarise.
// Nothing is dropped any more – the old 8,000-character cap meant only the
// first ~15 minutes of an episode were ever summarised.

const { entrySeconds } = require("../utils/formatter");

const CHUNK_MAX_CHARS = 1200;

function toChunk(index, entries, text) {
  const first = entries[0];
  const last = entries[entries.length - 1];

  return {
    index,
    startTime: first?.time || "00:00:00",
    endTime: last?.time || "00:00:00",
    endSeconds: entrySeconds(last),
    entryCount: entries.length,
    text,
  };
}

function buildSubtitleChunks(subtitles) {
  const chunks = [];
  let currentEntries = [];
  let currentText = "";

  for (const subtitle of subtitles) {
    const text = String(subtitle?.text || "").trim();
    if (!text) continue;

    const entryText = `[${subtitle.time || "00:00:00"}] ${text}`;

    if (currentText && currentText.length + entryText.length + 1 > CHUNK_MAX_CHARS) {
      chunks.push(toChunk(chunks.length, currentEntries, currentText));
      currentEntries = [];
      currentText = "";
    }

    currentEntries.push(subtitle);
    currentText = currentText ? `${currentText}\n${entryText}` : entryText;
  }

  if (currentEntries.length > 0) {
    chunks.push(toChunk(chunks.length, currentEntries, currentText));
  }

  return chunks;
}

// Sections are roughly minSectionChars long, and there are never more than
// maxSections of them (a long film just gets bigger sections), so the number
// of AI calls stays small.
function groupIntoSections(chunks, { maxSections = 8, minSectionChars = 16000 } = {}) {
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const count = Math.max(1, Math.min(maxSections, Math.ceil(totalChars / minSectionChars)));
  const charsPerSection = totalChars / count;

  const groups = Array.from({ length: count }, () => []);
  let position = 0;

  // Each chunk goes to the section its starting character falls in.
  for (const chunk of chunks) {
    const sectionIndex = Math.min(count - 1, Math.floor(position / charsPerSection));
    groups[sectionIndex].push(chunk);
    position += chunk.text.length;
  }

  return groups
    .filter((group) => group.length > 0)
    .map((sectionChunks, index) => ({
      index,
      startTime: sectionChunks[0].startTime,
      endTime: sectionChunks[sectionChunks.length - 1].endTime,
      chunks: sectionChunks,
    }));
}

module.exports = { buildSubtitleChunks, groupIntoSections, CHUNK_MAX_CHARS };