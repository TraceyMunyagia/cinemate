const summarizer = require("../services/summarizer");
const memoryService = require("../services/memoryService");
const contextService = require("../services/contextService");
const {
  HttpError,
  requireSubtitles,
  optionalString,
  optionalNumber,
  optionalBoolean,
} = require("../utils/validators");

// POST /summarize  { subtitles, episodeId?, videoTitle?, currentSeconds?, force?, allowSpoilers? }
async function summarize(req, res, next) {
  try {
    const { subtitles, episodeId, videoTitle, currentSeconds, force, allowSpoilers } = req.body;
    requireSubtitles(subtitles);
    optionalString(episodeId, "episodeId", 200);
    optionalString(videoTitle, "videoTitle", 300);
    optionalNumber(currentSeconds, "currentSeconds");
    optionalBoolean(force, "force");
    optionalBoolean(allowSpoilers, "allowSpoilers");

    // Spoiler guard: never summarise past where the viewer is,
    // unless the viewer turned it off.
    const visible = allowSpoilers ? subtitles : contextService.upTo(subtitles, currentSeconds);
    if (visible.length === 0) {
      throw new HttpError(400, "No captions before the current playback point yet.");
    }

    const fingerprint = contextService.fingerprint(visible);

    // Same captions as last time → reuse the saved summary (no AI call).
    if (episodeId && !force) {
      const saved = await memoryService.getEpisodeMemory(episodeId);

      if (saved?.fingerprint === fingerprint) {
        return res.json({
          success: true,
          cached: true,
          mock: false,
          episodeId: saved.episodeId,
          summary: saved.episodeMemory.summary,
          episodeMemory: saved.episodeMemory,
        });
      }
    }

    const { mock, episodeMemory } = await summarizer.buildEpisodeMemory(visible);
    const id = episodeId || `episode-${Date.now()}`;

    // Mock summaries are saved but never served from the cache.
    await memoryService.saveEpisodeMemory(id, episodeMemory, {
      fingerprint: mock ? null : fingerprint,
      title: videoTitle,
    });

    res.json({
      success: true,
      cached: false,
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