// services/contextService.js
// Picks which subtitles the AI gets to see.
//  - Spoiler guard: nothing after the viewer's current playback time.
//  - Chat: only the last few minutes of dialogue, not the last 5 lines.

const crypto = require("crypto");
const { entrySeconds, secondsToTime, timeToSeconds } = require("../utils/formatter");

const CHAT_WINDOW_SECONDS = 180; // last 3 minutes
const CHAT_MAX_CHARS = 4000;
const CHAT_MIN_LINES = 6; // quiet scene? still give the AI a few lines
const SUMMARY_GRACE_SECONDS = 30;

const hasNumber = (value) => typeof value === "number" && Number.isFinite(value);

// Subtitles at or before the viewer's position (all of them if unknown).
function upTo(subtitles, currentSeconds) {
  const list = Array.isArray(subtitles) ? subtitles : [];
  if (!hasNumber(currentSeconds)) return list;
  return list.filter((entry) => entrySeconds(entry) <= currentSeconds + 1);
}

function recentDialogue(subtitles, currentSeconds, options = {}) {
  const {
    windowSeconds = CHAT_WINDOW_SECONDS,
    maxChars = CHAT_MAX_CHARS,
    minLines = CHAT_MIN_LINES,
  } = options;

  const visible = upTo(subtitles, currentSeconds)
    .filter((entry) => String(entry?.text || "").trim())
    .sort((a, b) => entrySeconds(a) - entrySeconds(b));

  if (visible.length === 0) return [];

  const end = hasNumber(currentSeconds) ? currentSeconds : entrySeconds(visible[visible.length - 1]);
  let recent = visible.filter((entry) => entrySeconds(entry) >= end - windowSeconds);

  if (recent.length < minLines) {
    recent = visible.slice(-minLines);
  }

  // Keep the newest lines that fit in maxChars.
  const kept = [];
  let chars = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    chars += recent[i].text.length + 12;
    if (chars > maxChars && kept.length > 0) break;
    kept.unshift(recent[i]);
  }

  return kept;
}

function formatDialogue(entries) {
  return entries
    .map((entry) => `[${entry.time || secondsToTime(entrySeconds(entry))}] ${String(entry.text).trim()}`)
    .join("\n");
}

// Identifies an exact set of subtitles, for summary caching.
function fingerprint(subtitles) {
  const last = subtitles[subtitles.length - 1];
  const hash = crypto
    .createHash("sha1")
    .update(`${subtitles.length}|${entrySeconds(last)}|${last?.text || ""}`)
    .digest("hex")
    .slice(0, 12);

  return `${subtitles.length}-${hash}`;
}

// A saved summary is only safe to use in chat if it doesn't cover anything
// past the viewer's current position (e.g. after they rewound).
function spoilerSafeMemory(record, currentSeconds, graceSeconds = SUMMARY_GRACE_SECONDS) {
  const memory = record?.episodeMemory;
  if (!memory?.summary) return null;
  if (!hasNumber(currentSeconds)) return memory;

  const coveredUntil = memory.coverage?.endSeconds;
  if (!hasNumber(coveredUntil)) return null; // pre-Week-2 memory: unknown coverage

  return coveredUntil <= currentSeconds + graceSeconds ? memory : null;
}

// "00:12:03" or "12:03" – the AI sometimes writes "unknown" or leaves it out.
const isTimestamp = (value) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(value || "").trim());

// What chat may use from the saved episode memory at the viewer's position:
//  - "full":    the memory doesn't go past the viewer → use all of it
//  - "partial": it covers later scenes (viewer rewound) → only events
//               timestamped before the viewer's position
//  - null:      nothing safe to use
function memoryForChat(record, currentSeconds) {
  const memory = record?.episodeMemory;
  if (!memory?.summary) return null;

  const safe = spoilerSafeMemory(record, currentSeconds);
  if (safe) {
    return { scope: "full", coveredUntil: memory.coverage?.endTime || null, memory: safe };
  }

  if (!hasNumber(currentSeconds)) return null;

  const earlierEvents = (Array.isArray(memory.importantEvents) ? memory.importantEvents : []).filter(
    (event) => isTimestamp(event?.time) && timeToSeconds(event.time) <= currentSeconds
  );

  if (earlierEvents.length === 0) return null;

  return {
    scope: "partial",
    coveredUntil: secondsToTime(currentSeconds),
    memory: { importantEvents: earlierEvents },
  };
}

module.exports = {
  upTo,
  recentDialogue,
  formatDialogue,
  fingerprint,
  spoilerSafeMemory,
  memoryForChat,
  isTimestamp,
};