// tests/discussionPrompt.test.js  –  run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const {
  buildDiscussionPrompt,
  buildDiscussionSystemPrompt,
  formatEpisodeMemory,
} = require("../prompts/discussionPrompt");

const fullMemory = {
  scope: "full",
  coveredUntil: "00:10:00",
  memory: {
    summary: "They met at the studio.",
    characters: [{ name: "Amara", description: "Producer", emotionalState: "suspicious", goals: ["Find the tapes"] }],
    majorConflicts: [{ description: "Who locked the studio", charactersInvolved: ["Amara", "Kofi"], status: "unresolved" }],
    importantEvents: [{ time: "00:08:10", description: "Kofi lies about the keys" }],
    importantCharacterActions: [{ character: "Kofi", action: "Hides the keys" }],
    keyThemes: ["trust", "ambition"],
  },
};

test("includes position, title, full memory, dialogue and the spoiler rule", () => {
  const prompt = buildDiscussionPrompt("Why is she angry?", {
    personality: "theoryAnalyst",
    currentTime: "00:12:03",
    videoTitle: "Episode 3",
    dialogue: "[00:11:58] You lied to me.",
    episodeMemory: fullMemory,
  });

  assert.match(prompt, /Theory Analyst/);
  assert.match(prompt, /currently at 00:12:03/);
  assert.match(prompt, /watching: Episode 3/);
  assert.match(prompt, /story so far, up to 00:10:00/);
  assert.match(prompt, /Summary: They met at the studio\./);
  assert.match(prompt, /- Amara: Producer – feels suspicious – wants: Find the tapes/);
  assert.match(prompt, /- Who locked the studio \(Amara, Kofi\) \[unresolved\]/);
  assert.match(prompt, /- \[00:08:10\] Kofi lies about the keys/);
  assert.match(prompt, /- Kofi: Hides the keys/);
  assert.match(prompt, /Themes: trust, ambition/);
  assert.match(prompt, /\[00:11:58\] You lied to me\./);
  assert.match(prompt, /Never reveal/);
  assert.match(prompt, /"Why is she angry\?"/);
});

test("partial memory lists only the earlier events, with no summary", () => {
  const text = formatEpisodeMemory({
    scope: "partial",
    coveredUntil: "00:05:00",
    memory: { importantEvents: [{ time: "00:02:00", description: "The tapes go missing" }] },
  });

  assert.match(text, /only events before 00:05:00/);
  assert.match(text, /The tapes go missing/);
  assert.doesNotMatch(text, /Summary:/);
});

test("memory text is capped so it can't crowd out the dialogue", () => {
  const huge = {
    scope: "full",
    coveredUntil: "01:00:00",
    memory: { summary: "x".repeat(5000) },
  };
  assert.ok(formatEpisodeMemory(huge).length <= 2500);
});

test("tells the AI when there are no subtitles", () => {
  assert.match(buildDiscussionPrompt("Hi"), /No subtitles have been captured yet/);
});

test("with the spoiler guard off, the prompt allows spoilers (with a warning)", () => {
  const prompt = buildDiscussionPrompt("What happens next?", { allowSpoilers: true });
  assert.match(prompt, /Spoilers are allowed/);
  assert.match(prompt, /say "Spoiler:"/);
  assert.doesNotMatch(prompt, /Never reveal/);
  assert.match(buildDiscussionSystemPrompt({ allowSpoilers: true }), /Spoilers are allowed/);
});

test("the system prompt carries the spoiler rule too", () => {
  assert.match(buildDiscussionSystemPrompt({ personality: "filmCritic" }), /Spoiler rule/);
});