// services/memoryService.js
// Saves episode memories as JSON files in data/episode-memory/.
// File names are "<slug>-<hash>.json": YouTube ids are case-sensitive
// (abc ≠ ABC) but macOS file names aren't, so the hash keeps them apart.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { slugify } = require("../utils/formatter");
const logger = require("../utils/logger");

const DATA_DIR =
  process.env.EPISODE_MEMORY_DIR || path.join(__dirname, "..", "data", "episode-memory");

function fileNameFor(episodeId) {
  const id = String(episodeId);
  const hash = crypto.createHash("sha1").update(id).digest("hex").slice(0, 8);
  return `${slugify(id)}-${hash}.json`;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, "utf-8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// `fingerprint` identifies the exact subtitles the memory was built from.
// `fingerprint` identifies the exact subtitles the memory was built from.
async function saveEpisodeMemory(episodeId, episodeMemory, { fingerprint = null, title = "" } = {}) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });

  const record = {
    episodeId: String(episodeId),
    title: String(title || ""),
    savedAt: new Date().toISOString(),
    fingerprint,
    episodeMemory,
  };

  await fs.promises.writeFile(
    path.join(DATA_DIR, fileNameFor(episodeId)),
    JSON.stringify(record, null, 2)
  );
  logger.info(`Saved episode memory for "${record.episodeId}"`);

  return record;
}

async function getEpisodeMemory(episodeId) {
  const record = await readJson(path.join(DATA_DIR, fileNameFor(episodeId)));
  if (record) return record;

  // Files saved before Week 2 were named "<slug>.json".
  return readJson(path.join(DATA_DIR, `${slugify(episodeId)}.json`));
}

async function listEpisodeMemories() {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const files = (await fs.promises.readdir(DATA_DIR)).filter((file) => file.endsWith(".json"));

  const records = await Promise.all(files.map((file) => readJson(path.join(DATA_DIR, file))));

  return records
    .filter(Boolean)
    .map((record) => ({
      episodeId: record.episodeId,
      title: record.title || "",
      savedAt: record.savedAt,
      summary: record.episodeMemory?.summary || "",
      coveredUntil: record.episodeMemory?.coverage?.endTime || null,
      coveredUntilSeconds: record.episodeMemory?.coverage?.endSeconds ?? null,
    }))
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

// Removes the saved memory (new and pre-Week-2 file names). True if anything was deleted.
async function deleteEpisodeMemory(episodeId) {
  const candidates = [fileNameFor(episodeId), `${slugify(episodeId)}.json`];
  let deleted = false;

  for (const file of candidates) {
    try {
      await fs.promises.unlink(path.join(DATA_DIR, file));
      deleted = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  if (deleted) logger.info(`Deleted episode memory for "${episodeId}"`);
  return deleted;
}

module.exports = {
  saveEpisodeMemory,
  getEpisodeMemory,
  listEpisodeMemories,
  deleteEpisodeMemory,
  fileNameFor,
};