const geminiService = require("../services/geminiService");
const { buildDiscussionPrompt, buildDiscussionSystemPrompt } = require("../prompts/discussionPrompt");
const { getPersona } = require("../prompts/personalityPrompt");
const { requireMessage, optionalSubtitles, optionalHistory } = require("../utils/validators");

const USE_MOCK_AI = process.env.USE_MOCK_AI === "true";

async function chat(req, res, next) {
  try {
    const { subtitles, message, personality, history } = req.body;
    requireMessage(message);
    optionalSubtitles(subtitles);
    optionalHistory(history);

    const subtitleText = (subtitles || [])
      .slice(-5)
      .map((s) => s.text)
      .join(" ");

    if (USE_MOCK_AI) {
      return res.json({
        success: true,
        mock: true,
        reply: `Mock reply (${getPersona(personality).label}) to: "${message}". I can discuss the scene using the captured subtitle context.`,
      });
    }

    const prompt = buildDiscussionPrompt(message, subtitleText, { personality, history });
    const reply = await geminiService.generateReply(
      prompt,
      buildDiscussionSystemPrompt({ personality })
    );

    res.json({
      success: true,
      provider: geminiService.isUsingAnthropic() ? "anthropic" : "gemini",
      reply,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { chat };
