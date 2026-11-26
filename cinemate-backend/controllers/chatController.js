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
  optionalBoolean,
} = require("../utils/validators");

// POST /chat { message, subtitles?, personality?, history?, episodeId?, videoTitle?,
//              currentSeconds?, allowSpoilers? }
async function chat(req, res, next) {
  try {
    const {
      subtitles,
      message,
      personality,
      history,
      episodeId,
      videoTitle,
      currentSeconds,
      allowSpoilers,
    } = req.body;
    requireMessage(message);
    optionalSubtitles(subtitles);
    optionalHistory(history);
    optionalString(episodeId, "episodeId", 200);
    optionalString(videoTitle, "videoTitle", 300);
    optionalNumber(currentSeconds, "currentSeconds");
    optionalBoolean(allowSpoilers, "allowSpoilers");

    // Last few minutes before the viewer's position – nothing after it.
    const recent = contextService.recentDialogue(subtitles || [], currentSeconds);

    // The saved episode memory (summary, characters, conflicts, events) –
    // only the parts that don't go past the viewer's position, unless the
    // viewer turned the spoiler guard off.
    const saved = episodeId ? await memoryService.getEpisodeMemory(episodeId) : null;
    const episodeMemory = contextService.memoryForChat(saved, allowSpoilers ? null : currentSeconds);
    const memoryScope = episodeMemory?.scope || "none";

    const currentTime = Number.isFinite(currentSeconds) ? secondsToTime(currentSeconds) : null;

    if (config.useMockAi) {
      return res.json({
        success: true,
        mock: true,
        reply:
          `Mock reply (${getPersona(personality).label}) at ${currentTime || "unknown time"}, ` +
          `using ${recent.length} lines of dialogue + memory: ${memoryScope}` +
          `${allowSpoilers ? " (spoilers on)" : ""}, to: "${message}"`,
        context: { lines: recent.length, memory: memoryScope },
      });
    }

    const prompt = buildDiscussionPrompt(message, {
      personality,
      history,
      dialogue: contextService.formatDialogue(recent),
      currentTime,
      videoTitle,
      episodeMemory,
      allowSpoilers,
    });

    const reply = await aiService.generateReply(
      prompt,
      buildDiscussionSystemPrompt({ personality, allowSpoilers })
    );

    res.json({
      success: true,
      provider: aiService.getProviderName(),
      reply,
      context: { lines: recent.length, memory: memoryScope },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { chat };