const config = require("../config");
const aiService = require("../services/aiService");
const memoryService = require("../services/memoryService");
const contextService = require("../services/contextService");
const { buildDiscussionPrompt, buildDiscussionSystemPrompt } = require("../prompts/discussionPrompt");
const { getPersona } = require("../prompts/personalityPrompt");
const { secondsToTime } = require("../utils/formatter");
const {
  requireMessage,
  optionalSubtitles,
  optionalHistory,
  optionalNumber,
  optionalString,
} = require("../utils/validators");

// POST /chat { message, subtitles?, personality?, history?, episodeId?, videoTitle?, currentSeconds? }
async function chat(req, res, next) {
  try {
    const { subtitles, message, personality, history, episodeId, videoTitle, currentSeconds } = req.body;
    requireMessage(message);
    optionalSubtitles(subtitles);
    optionalHistory(history);
    optionalString(episodeId, "episodeId", 200);
    optionalString(videoTitle, "videoTitle", 300);
    optionalNumber(currentSeconds, "currentSeconds");

    // Last few minutes before the viewer's position – nothing after it.
    const recent = contextService.recentDialogue(subtitles || [], currentSeconds);

    // The saved summary helps with "story so far" questions, but only if it
    // doesn't cover scenes the viewer hasn't reached.
    const saved = episodeId ? await memoryService.getEpisodeMemory(episodeId) : null;
    const memory = contextService.spoilerSafeMemory(saved, currentSeconds);

    const currentTime = Number.isFinite(currentSeconds) ? secondsToTime(currentSeconds) : null;

    if (config.useMockAi) {
      return res.json({
        success: true,
        mock: true,
        reply:
          `Mock reply (${getPersona(personality).label}) at ${currentTime || "unknown time"}, ` +
          `using ${recent.length} lines of dialogue${memory ? " + the episode summary" : ""}, to: "${message}"`,
        context: { lines: recent.length, usedSummary: Boolean(memory) },
      });
    }

    const prompt = buildDiscussionPrompt(message, {
      personality,
      history,
      dialogue: contextService.formatDialogue(recent),
      currentTime,
      videoTitle,
      episodeSummary: memory
        ? { text: memory.summary, coveredUntil: memory.coverage?.endTime || "earlier" }
        : null,
    });

    const reply = await aiService.generateReply(prompt, buildDiscussionSystemPrompt({ personality }));

    res.json({
      success: true,
      provider: aiService.getProviderName(),
      reply,
      context: { lines: recent.length, usedSummary: Boolean(memory) },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { chat };