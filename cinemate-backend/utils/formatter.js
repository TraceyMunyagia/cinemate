function extractJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      throw new Error("AI response did not contain a JSON object.");
    }

    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return slug || "episode";
}

// "01:02:03" -> 3723 (also accepts "02:03")
function timeToSeconds(text) {
  const parts = String(text || "").split(":").map(Number);
  if (parts.length === 0 || parts.some((part) => Number.isNaN(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

// 3723 -> "01:02:03"
function secondsToTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}

// Subtitle entries from Week 1 have `seconds`; older ones only have `time`.
function entrySeconds(entry) {
  return Number.isFinite(entry?.seconds) ? entry.seconds : timeToSeconds(entry?.time);
}

module.exports = { extractJson, slugify, timeToSeconds, secondsToTime, entrySeconds };