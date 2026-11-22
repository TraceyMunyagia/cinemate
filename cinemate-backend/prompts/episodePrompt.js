const { EPISODE_MEMORY_PERSONA } = require("./personalityPrompt");

// The JSON shape every episode memory (and every section memory) uses.
const MEMORY_SHAPE = `{
  "summary": "Concise summary in 3-6 sentences.",
  "characters": [
    {
      "name": "Character name or unknown label",
      "description": "What can be inferred from the subtitles.",
      "emotionalState": "Brief emotional state if clear from dialogue.",
      "goals": ["Goal or motivation if clear."]
    }
  ],
  "importantEvents": [
    {
      "time": "HH:MM:SS if available",
      "description": "Important event from the subtitles.",
      "whyItMatters": "Why this event matters."
    }
  ],
  "keyThemes": ["Theme"],
  "emotionalMoments": [
    {
      "time": "HH:MM:SS if available",
      "description": "Emotionally important moment.",
      "emotion": "Primary emotion."
    }
  ],
  "majorConflicts": [
    {
      "description": "Conflict description.",
      "charactersInvolved": ["Character name"],
      "status": "resolved, unresolved, or unclear"
    }
  ],
  "importantCharacterActions": [
    {
      "character": "Character name or unknown label",
      "action": "Important action or decision.",
      "impact": "Impact on the episode."
    }
  ]`;

const JSON_RULES =
  "Return ONLY valid JSON. Do not include markdown, backticks, comments, or prose outside the JSON.";

const HONESTY_RULES =
  "Use empty arrays when information is not available. Do not invent names if the subtitles do not reveal them. " +
  "Only describe what the subtitles show – do not add events from outside knowledge of the show or film.";

// One pass over subtitle chunks. With `part`/`totalParts` it summarises one
// section of a longer episode; without them it summarises the whole thing.
function buildEpisodePrompt(subtitleChunks, { part, totalParts } = {}) {
  const isSection = Boolean(part && totalParts);
  const first = subtitleChunks[0];
  const last = subtitleChunks[subtitleChunks.length - 1];

  const scope = isSection
    ? `These chunks are part ${part} of ${totalParts} of the episode, covering ${first.startTime}–${last.endTime}. Summarise only this part.`
    : "Summarise this episode.";

  const chunkList = subtitleChunks.map(({ index, startTime, endTime, text }) => ({
    index,
    startTime,
    endTime,
    text,
  }));

  return `
${EPISODE_MEMORY_PERSONA}

Convert the subtitle chunks into a structured memory.
${scope}

Identify:
- key themes
- emotional moments
- major conflicts
- important character actions

${JSON_RULES}

The JSON object must have this exact shape:
${MEMORY_SHAPE},
  "subtitleChunks": [
    {
      "index": 0,
      "summary": "Short summary of this chunk. Use the chunk's own index."
    }
  ]
}

${HONESTY_RULES}

Subtitle chunks:
${JSON.stringify(chunkList, null, 2)}
`;
}

// Combines the section memories of a long episode into one episode memory.
function buildMergePrompt(sectionMemories) {
  return `
${EPISODE_MEMORY_PERSONA}

A long episode was summarised in ${sectionMemories.length} consecutive parts.
Merge the part memories below into ONE memory for the whole episode, in story order:
- write one summary for the whole episode (3-6 sentences)
- merge duplicate characters (same person, different labels) into one entry
- keep the most important events and moments, with their times
- update conflict status using later parts (a conflict opened in part 1 may be resolved in part 3)

${JSON_RULES}

The JSON object must have this exact shape:
${MEMORY_SHAPE}
}

${HONESTY_RULES}

Part memories:
${JSON.stringify(sectionMemories, null, 2)}
`;
}

module.exports = { buildEpisodePrompt, buildMergePrompt };