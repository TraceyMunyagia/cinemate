const { getPersona, EMOTIONAL_TONE_GUIDANCE } = require("./personalityPrompt");

const SPOILER_RULES =
  "Spoiler rule: you only know what has happened up to the viewer's current position. " +
  "Never reveal, hint at or confirm anything that happens later – even if you recognise the show or film. " +
  "If they ask what happens next, make a fun guess and say clearly that it's a guess. " +
  "Only discuss later events if the viewer explicitly asks for spoilers, and warn them first.";

const MEMORY_MAX_CHARS = 2500;
const LIMITS = { characters: 8, conflicts: 5, events: 10, actions: 5, themes: 6 };

const list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []);

function formatHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return "";

  const turns = history
    .slice(-10)
    .map((turn) => `${turn.role === "user" ? "User" : "CineMate"}: ${turn.content}`)
    .join("\n");

  return `Conversation so far:\n${turns}\n`;
}

function formatCharacter(character) {
  const details = [
    character.description,
    character.emotionalState && `feels ${character.emotionalState}`,
    list(character.goals, 2).length > 0 && `wants: ${list(character.goals, 2).join("; ")}`,
  ].filter(Boolean);

  return `- ${character.name || "Unknown"}: ${details.join(" – ")}`;
}

function formatConflict(conflict) {
  const who = list(conflict.charactersInvolved, 4).join(", ");
  return `- ${conflict.description}${who ? ` (${who})` : ""} [${conflict.status || "unclear"}]`;
}

// Turns { scope, coveredUntil, memory } from contextService.memoryForChat
// into a compact block for the prompt.
function formatEpisodeMemory(episodeMemory) {
  if (!episodeMemory?.memory) return "";

  const { scope, coveredUntil, memory } = episodeMemory;
  const sections = [];

  if (scope === "partial") {
    sections.push(
      `Earlier events (from a summary that also covers scenes the viewer hasn't reached – only events before ${coveredUntil} are listed):`
    );
  } else {
    sections.push(`Episode memory (story so far, up to ${coveredUntil || "the viewer's position"}):`);
    if (memory.summary) sections.push(`Summary: ${memory.summary}`);
  }

  const characters = list(memory.characters, LIMITS.characters);
  if (characters.length > 0) sections.push(`Characters:\n${characters.map(formatCharacter).join("\n")}`);

  const conflicts = list(memory.majorConflicts, LIMITS.conflicts);
  if (conflicts.length > 0) sections.push(`Major conflicts:\n${conflicts.map(formatConflict).join("\n")}`);

  // Most recent events are the most useful, so keep the last ones.
  const events = Array.isArray(memory.importantEvents) ? memory.importantEvents.slice(-LIMITS.events) : [];
  if (events.length > 0) {
    sections.push(
      `Key events:\n${events.map((event) => `- [${event.time || "?"}] ${event.description}`).join("\n")}`
    );
  }

  const actions = list(memory.importantCharacterActions, LIMITS.actions);
  if (actions.length > 0) {
    sections.push(
      `Important actions:\n${actions.map((a) => `- ${a.character}: ${a.action}`).join("\n")}`
    );
  }

  const themes = list(memory.keyThemes, LIMITS.themes);
  if (themes.length > 0) sections.push(`Themes: ${themes.join(", ")}`);

  const text = sections.join("\n");
  return text.length > MEMORY_MAX_CHARS ? `${text.slice(0, MEMORY_MAX_CHARS - 1)}…` : text;
}

// options: { personality, history, dialogue, currentTime, videoTitle, episodeMemory }
function buildDiscussionPrompt(message, options = {}) {
  const { persona } = getPersona(options.personality);

  const watching = options.videoTitle ? `The viewer is watching: ${options.videoTitle}\n` : "";
  const position = options.currentTime
    ? `They are currently at ${options.currentTime} (the video may be paused).\n`
    : "";
  const memory = formatEpisodeMemory(options.episodeMemory);
  const dialogue = options.dialogue
    ? `Dialogue from the last few minutes, oldest first:\n${options.dialogue}`
    : "No subtitles have been captured yet – say so if the question needs them, and suggest turning on captions (CC).";

  return `
${persona}
${EMOTIONAL_TONE_GUIDANCE}
${SPOILER_RULES}

${watching}${position}
${memory ? `${memory}\n` : ""}
${dialogue}

${formatHistory(options.history)}
User says:
"${message}"
Use the episode memory for "story so far" questions and the recent dialogue for "right now" questions.
Respond naturally and stay consistent with the conversation so far.
`;
}

function buildDiscussionSystemPrompt(options = {}) {
  const { persona } = getPersona(options.personality);
  return `${persona} ${EMOTIONAL_TONE_GUIDANCE} ${SPOILER_RULES} Keep replies natural, concise, and grounded in the available subtitles, episode memory and prior conversation.`;
}

module.exports = {
  buildDiscussionPrompt,
  buildDiscussionSystemPrompt,
  formatEpisodeMemory,
  SPOILER_RULES,
};