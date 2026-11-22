// tests/discussionPrompt.test.js  –  run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { buildDiscussionPrompt, buildDiscussionSystemPrompt } = require("../prompts/discussionPrompt");

test("includes position, title, summary, dialogue and the spoiler rule", () => {
  const prompt = buildDiscussionPrompt("Why is she angry?", {
    personality: "theoryAnalyst",
    currentTime: "00:12:03",
    videoTitle: "Episode 3",
    dialogue: "[00:11:58] You lied to me.",
    episodeSummary: { text: "They met at the studio.", coveredUntil: "00:10:00" },
  });

  assert.match(prompt, /Theory Analyst/);
  assert.match(prompt, /currently at 00:12:03/);
  assert.match(prompt, /watching: Episode 3/);
  assert.match(prompt, /summary up to 00:10:00/);
  assert.match(prompt, /\[00:11:58\] You lied to me\./);
  assert.match(prompt, /Never reveal/);
  assert.match(prompt, /"Why is she angry\?"/);
});

test("tells the AI when there are no subtitles", () => {
  assert.match(buildDiscussionPrompt("Hi"), /No subtitles have been captured yet/);
});

test("the system prompt carries the spoiler rule too", () => {
  assert.match(buildDiscussionSystemPrompt({ personality: "filmCritic" }), /Spoiler rule/);
});