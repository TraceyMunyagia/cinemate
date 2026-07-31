const summarizer = require("../services/summarizer");
const memoryService = require("../services/memoryService");
const { requireSubtitles } = require("../utils/validators");

async function summarize(req, res, next) {
  try {
    const { subtitles, episodeId } = req.body;
    requireSubtitles(subtitles);

    const { mock, episodeMemory } = await summarizer.buildEpisodeMemory(subtitles);
    const id = episodeId || `episode-${Date.now()}`;
    await memoryService.saveEpisodeMemory(id, episodeMemory);

    res.json({
      success: true,
      mock,
      episodeId: id,
      summary: episodeMemory.summary,
      episodeMemory,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { summarize };
