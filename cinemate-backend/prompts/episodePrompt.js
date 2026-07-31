const { EPISODE_MEMORY_PERSONA } = require("./personalityPrompt");

function buildEpisodePrompt(subtitleChunks) {
  return `
${EPISODE_MEMORY_PERSONA}

Convert the subtitle chunks into a structured episode memory.

Summarize this episode and identify:
- key themes
- emotional moments
- major conflicts
- important character actions

Return ONLY valid JSON. Do not include markdown, backticks, comments, or prose outside the JSON.

The JSON object must have this exact shape:
{
  "summary": "Concise episode summary in 3-6 sentences.",
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
  ],
  "subtitleChunks": [
    {
      "index": 0,
      "summary": "Short summary of this chunk."
    }
  ]
}

Use empty arrays when information is not available. Do not invent names if the subtitles do not reveal them.

Subtitle chunks:
${JSON.stringify(subtitleChunks, null, 2)}
`;
}

module.exports = { buildEpisodePrompt };
