const { getPersona, EMOTIONAL_TONE_GUIDANCE } = require("./personalityPrompt");

const SPOILER_RULES =
  "Spoiler rule: you only know what has happened up to the viewer's current position. " +
  "Never reveal, hint at or confirm anything that happens later – even if you recognise the show or film. " +
  "If they ask what happens next, make a fun guess and say clearly that it's a guess. " +
  "Only discuss later events if the viewer explicitly asks for spoilers, and warn them first.";

function formatHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return "";

  const turns = history
    .slice(-10)
    .map((turn) => `${turn.role === "user" ? "User" : "CineMate"}: ${turn.content}`)
    .join("\n");

  return `Conversation so far:\n${turns}\n`;
}

// options: { personality, history, dialogue, currentTime, videoTitle, episodeSummary }
function buildDiscussionPrompt(message, options = {}) {
  const { persona } = getPersona(options.personality);

  const watching = options.videoTitle ? `The viewer is watching: ${options.videoTitle}\n` : "";
  const position = options.currentTime
    ? `They are currently at ${options.currentTime} (the video may be paused).\n`
    : "";
  const storySoFar = options.episodeSummary
    ? `Story so far (summary up to ${options.episodeSummary.coveredUntil}):\n${options.episodeSummary.text}\n`
    : "";
  const dialogue = options.dialogue
    ? `Dialogue from the last few minutes, oldest first:\n${options.dialogue}`
    : "No subtitles have been captured yet – say so if the question needs them, and suggest turning on captions (CC).";

  return `
${persona}
${EMOTIONAL_TONE_GUIDANCE}
${SPOILER_RULES}

${watching}${position}
${storySoFar}
${dialogue}

${formatHistory(options.history)}
User says:
"${message}"
Respond naturally and stay consistent with the conversation so far.
`;
}

function buildDiscussionSystemPrompt(options = {}) {
  const { persona } = getPersona(options.personality);
  return `${persona} ${EMOTIONAL_TONE_GUIDANCE} ${SPOILER_RULES} Keep replies natural, concise, and grounded in the available subtitles and prior conversation.`;
}

module.exports = { buildDiscussionPrompt, buildDiscussionSystemPrompt, SPOILER_RULES };