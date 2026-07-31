const fs = require("fs");
const path = require("path");
const { slugify } = require("../utils/formatter");
const logger = require("../utils/logger");

const DATA_DIR = path.join(__dirname, "..", "data", "episode-memory");

function resolveFilePath(episodeId) {
  return path.join(DATA_DIR, `${slugify(episodeId)}.json`);
}

async function saveEpisodeMemory(episodeId, episodeMemory) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });

  const id = slugify(episodeId);
  const record = {
    episodeId: id,
    savedAt: new Date().toISOString(),
    episodeMemory,
  };

  await fs.promises.writeFile(resolveFilePath(id), JSON.stringify(record, null, 2));
  logger.info(`Saved episode memory for "${id}"`);

  return record;
}

async function getEpisodeMemory(episodeId) {
  try {
    const raw = await fs.promises.readFile(resolveFilePath(episodeId), "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function listEpisodeMemories() {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const files = await fs.promises.readdir(DATA_DIR);

  const records = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        const raw = await fs.promises.readFile(path.join(DATA_DIR, file), "utf-8");
        const record = JSON.parse(raw);

        return {
          episodeId: record.episodeId,
          savedAt: record.savedAt,
          summary: record.episodeMemory?.summary || "",
        };
      })
  );

  return records.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

module.exports = { saveEpisodeMemory, getEpisodeMemory, listEpisodeMemories };
