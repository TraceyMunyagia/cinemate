const { getPersona, EMOTIONAL_TONE_GUIDANCE } = require("./personalityPrompt");

function formatHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return "";

  const turns = history
    .slice(-10)
    .map((turn) => `${turn.role === "user" ? "User" : "CineMate"}: ${turn.content}`)
    .join("\n");

  return `Conversation so far:\n${turns}\n`;
}

function buildDiscussionPrompt(message, subtitleText, options = {}) {
  const { persona } = getPersona(options.personality);
  const historyBlock = formatHistory(options.history);

  return `
${persona}
${EMOTIONAL_TONE_GUIDANCE}

The user just watched an episode.
Recent episode dialogue, if available:
${subtitleText || "No subtitles are available yet."}

${historyBlock}
User says:
"${message}"
Respond naturally and stay consistent with the conversation so far.
`;
}

function buildDiscussionSystemPrompt(options = {}) {
  const { persona } = getPersona(options.personality);
  return `${persona} ${EMOTIONAL_TONE_GUIDANCE} Keep replies natural, concise, and grounded in the available subtitles and prior conversation.`;
}

module.exports = { buildDiscussionPrompt, buildDiscussionSystemPrompt };
