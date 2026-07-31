const MAX_CHARS = 8000;
const CHUNK_MAX_CHARS = 1200;

function buildSubtitleChunks(subtitles) {
  const chunks = [];
  let currentEntries = [];
  let currentText = "";
  let totalChars = 0;

  for (const subtitle of subtitles) {
    const text = String(subtitle.text || "").trim();
    if (!text) continue;

    const entryText = `[${subtitle.time || "00:00:00"}] ${text}`;

    if (totalChars + entryText.length > MAX_CHARS) break;

    if (currentText && currentText.length + entryText.length + 1 > CHUNK_MAX_CHARS) {
      chunks.push({
        index: chunks.length,
        startTime: currentEntries[0]?.time || "00:00:00",
        endTime: currentEntries[currentEntries.length - 1]?.time || "00:00:00",
        entryCount: currentEntries.length,
        text: currentText,
      });

      currentEntries = [];
      currentText = "";
    }

    currentEntries.push(subtitle);
    currentText = currentText ? `${currentText}\n${entryText}` : entryText;
    totalChars += entryText.length;
  }

  if (currentEntries.length > 0) {
    chunks.push({
      index: chunks.length,
      startTime: currentEntries[0]?.time || "00:00:00",
      endTime: currentEntries[currentEntries.length - 1]?.time || "00:00:00",
      entryCount: currentEntries.length,
      text: currentText,
    });
  }

  return chunks;
}

module.exports = { buildSubtitleChunks };
