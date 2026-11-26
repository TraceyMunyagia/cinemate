// panel.js
// The CineMate discussion panel: chat, voice, summary and sessions.
// Each video has its own chat and saved memory, and the panel follows
// whichever video is active (the tab you clicked 🎬 in or switched to last).
// Voice uses Chrome's own speech recognition and voice by default, pauses
// (or turns down) the video while you talk, and Stop / Esc cuts CineMate off.

// ---------- Elements ----------

const talkBtn = document.getElementById("talkBtn");
const statusDiv = document.getElementById("status");
const conversationDiv = document.getElementById("conversation");
const voiceHint = document.getElementById("voiceHint");
const summaryBtn = document.getElementById("summaryBtn");
const chatTab = document.getElementById("chatTab");
const summaryTab = document.getElementById("summaryTab");
const sessionsTab = document.getElementById("sessionsTab");
const summaryPanel = document.getElementById("summaryPanel");
const summaryNotice = document.getElementById("summaryNotice");
const summaryContent = document.getElementById("summaryContent");
const summaryText = document.getElementById("summaryText");
const themeChips = document.getElementById("themeChips");
const eventsList = document.getElementById("eventsList");
const spoilerGate = document.getElementById("spoilerGate");
const spoilerGateText = document.getElementById("spoilerGateText");
const revealSummaryBtn = document.getElementById("revealSummaryBtn");
const sessionsPanel = document.getElementById("sessionsPanel");
const sessionsList = document.getElementById("sessionsList");
const saveNotesBtn = document.getElementById("saveNotesBtn");
const newChatBtn = document.getElementById("newChatBtn");
const personaButtons = document.querySelectorAll(".persona-pill");
const videoTitleDiv = document.getElementById("videoTitle");
const clearCaptionsBtn = document.getElementById("clearCaptionsBtn");
const textForm = document.getElementById("textForm");
const textInput = document.getElementById("textInput");
const sendBtn = document.getElementById("sendBtn");
const stopBtn = document.getElementById("stopBtn");
const settingsBtn = document.getElementById("settingsBtn");
const banner = document.getElementById("banner");
const bannerText = document.getElementById("bannerText");
const bannerAction = document.getElementById("bannerAction");

const { storage, context, api, sessions, time, speech, listen, status: statusBanner } = globalThis.CineMate;

const STATUS_CHECK_MS = 10000; // how often to check the video tab (captions, reachable)
const HEALTH_CHECK_MS = 30000; // how often to check the server
const WELCOME_MESSAGE = "Ask me about the scene, character choices, conflicts, or what just happened.";
const SESSIONS_REFRESH_MS = 10000; // re-draw the Sessions tab at most this often
const MEMORY_LIST_CACHE_MS = 30000; // how long to reuse GET /memory
const DEFAULT_HINT = "Type a question or tap 🎙 to talk · Esc stops";

// ---------- State ----------

let voiceSettings = { ...storage.DEFAULT_VOICE_SETTINGS };
let listenSession = null; // the microphone session while you're talking
let isListening = false;
let listeningCancelled = false; // Esc while listening → "Stopped.", not "didn't catch that"
let currentTurn = null; // { abort, voice } while CineMate is thinking or speaking
let heldVideo = null; // the video we paused / turned down, so we restore the right one
let isBusy = false;

let generalSettings = { ...storage.DEFAULT_SETTINGS }; // backend URL, spoiler guard
let serverState = "unknown"; // "ok" | "offline" | "unknown"
let lastHealth = null; // last /health reply
let lastHealthAt = 0;
let statusTimer = null;
let bannerActionType = null; // "retry" | "refresh" | null

let currentPersonality = storage.DEFAULT_PERSONALITY;
let activeVideo = null; // the video the panel follows
let chatVideoId; // whose chat + summary are on screen (undefined = nothing loaded yet)
let conversationHistory = []; // the chat on screen
let lastEpisodeMemory = null; // the summary on screen
let hiddenMemory = null; // saved summary held back by the spoiler check
let currentView = "chat";
let loadToken = 0; // lets a slow load notice that the video changed meanwhile

let cooldownUntil = 0; // set after a rate limit; AI buttons stay off until then
let cooldownTimer = null;

let sessionsRenderedAt = 0;
let memoryListCache = { at: 0, list: [], failed: false };

// ---------- Start ----------

restorePersonality();
loadVoiceSettings();
loadGeneralSettings().then(() => {
  refreshVideoInfo(); // needs the server address for the saved summary
  startStatusChecks();
});
storage.watch(handleStorageChange);

textForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = textInput.value.trim();
  if (!message || isBusy || isListening) return;
  textInput.value = "";
  sendTextMessage(message);
});

talkBtn.addEventListener("click", toggleListening);
stopBtn.addEventListener("click", stopEverything);
settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
bannerAction.addEventListener("click", handleBannerAction);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") stopEverything();
});

// Closing the panel mid-reply shouldn't leave the video paused.
window.addEventListener("pagehide", stopEverything);

document.querySelectorAll("[data-message]").forEach((button) => {
  button.addEventListener("click", () => {
    sendTextMessage(button.dataset.message);
  });
});

summaryBtn?.addEventListener("click", generateSummary);
chatTab?.addEventListener("click", () => setView("chat"));
summaryTab?.addEventListener("click", () => setView("summary"));
sessionsTab?.addEventListener("click", () => setView("sessions"));
saveNotesBtn?.addEventListener("click", saveNotes);
newChatBtn?.addEventListener("click", startNewChat);
clearCaptionsBtn?.addEventListener("click", clearCaptions);
revealSummaryBtn?.addEventListener("click", revealHiddenSummary);

personaButtons.forEach((button) => {
  button.addEventListener("click", () => setPersonality(button.dataset.personality));
});

// ---------- Personality ----------

// The settings page edits the same value, so a change there shows up here.
function setPersonality(personality, { save = true } = {}) {
  currentPersonality = personality;

  personaButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.personality === personality);
  });

  if (save) storage.savePersonality(personality);
}

async function restorePersonality() {
  setPersonality(await storage.getPersonality(), { save: false });
}

// ---------- Active video ----------

async function refreshVideoInfo() {
  activeVideo = await storage.getActiveVideo();
  const videoId = activeVideo?.videoId || null;

  if (!activeVideo) {
    videoTitleDiv.innerText = "No video detected – open YouTube or Netflix";
    videoTitleDiv.title = "";
    clearCaptionsBtn.disabled = true;
  } else {
    const subtitles = await storage.getSubtitles(videoId);
    const name = activeVideo.title || "Untitled video";
    const lines = subtitles.length === 1 ? "1 line" : `${subtitles.length} lines`;

    videoTitleDiv.innerText = `${name} · ${lines}`;
    videoTitleDiv.title = name;
    clearCaptionsBtn.disabled = subtitles.length === 0;
  }

  // Switched to a different video → show its chat and summary.
  if (videoId !== chatVideoId) {
    await loadEpisode(videoId);
    checkStatus();
  }

  if (currentView === "sessions") renderSessions();
}

function handleStorageChange(changes) {
  if (changes[storage.KEYS.VOICE]) {
    voiceSettings = { ...storage.DEFAULT_VOICE_SETTINGS, ...(changes[storage.KEYS.VOICE].newValue || {}) };
    updateHint();
  }

  if (changes[storage.KEYS.SETTINGS]) {
    applyGeneralSettings(changes[storage.KEYS.SETTINGS].newValue);
  }

  if (changes[storage.KEYS.PERSONALITY]?.newValue) {
    setPersonality(changes[storage.KEYS.PERSONALITY].newValue, { save: false });
  }

  const activeChanged = Boolean(changes[storage.KEYS.ACTIVE]);
  const captionsChanged =
    activeVideo && Boolean(changes[storage.subtitleKey(activeVideo.videoId)]);
  const sessionsChanged = Boolean(changes[storage.KEYS.SESSIONS]);

  if (activeChanged || captionsChanged) {
    refreshVideoInfo();
  } else if (sessionsChanged && currentView === "sessions") {
    renderSessions();
  }
}

async function clearCaptions() {
  if (!activeVideo) return;

  await storage.clearSubtitles(activeVideo.videoId);
  statusDiv.innerText = "Captions cleared for this video.";
}

// ---------- Per-video chat + saved memory ----------

async function loadEpisode(videoId) {
  const token = ++loadToken;

  chatVideoId = videoId;
  conversationHistory = [];
  renderConversation([]);
  resetSummaryView();

  const history = await storage.getHistory(videoId);
  if (token !== loadToken) return; // switched again while loading

  conversationHistory = history;
  renderConversation(history);

  if (videoId) await loadSavedMemory(videoId, token);
}

// Shows the summary saved on the backend – unless it covers scenes after
// the viewer's position, in which case it waits behind "Show it anyway".
async function loadSavedMemory(videoId, token) {
  let record;

  try {
    record = await api.getMemory(videoId);
  } catch (err) {
    console.info("Saved memory unavailable:", err.message);
    return; // server offline – the panel still works without it
  }

  if (token !== loadToken || !record?.episodeMemory) return;

  const { currentSeconds } = await getViewingContext(activeVideo);
  if (token !== loadToken) return;

  if (generalSettings.spoilerGuard && sessions.isMemoryAhead(record.episodeMemory, currentSeconds)) {
    showSpoilerGate(record.episodeMemory, currentSeconds);
  } else {
    renderSummary(record.episodeMemory, { savedAt: record.savedAt });
  }
}

function showSpoilerGate(memory, currentSeconds) {
  hiddenMemory = memory;
  summaryContent.hidden = true;
  spoilerGate.hidden = false;
  summaryNotice.hidden = true;

  spoilerGateText.innerText =
    `It covers up to ${memory.coverage.endTime}, but you're at ${time.formatTime(currentSeconds)}. ` +
    "Generate a new summary for where you are, or show it anyway (spoilers!).";
}

function revealHiddenSummary() {
  if (hiddenMemory) renderSummary(hiddenMemory);
}

// ---------- Chat ----------

async function sendTextMessage(message) {
  const text = String(message || "").trim();
  if (!text || isBusy) return;

  setBusy(true);

  // The reply belongs to this video's chat, even if you switch tabs meanwhile.
  const video = activeVideo;
  const videoId = chatVideoId;
  const history = conversationHistory.slice();
  const turn = { abort: new AbortController(), voice: null };
  currentTurn = turn;
  showStopButton(true);

  try {
    setView("chat");
    addMessage("You", text, { videoId });
    statusDiv.innerText = "Thinking...";
    showThinking();

    const reply = await askCineMate(text, { video, history, signal: turn.abort.signal });

    hideThinking();
    addMessage("CineMate", reply, { videoId });

    if (videoId !== chatVideoId) {
      statusDiv.innerText = `Reply saved to the chat for "${video?.title || "the previous video"}".`;
      return;
    }

    if (voiceSettings.output === "off") {
      statusDiv.innerText = "Ready";
      return;
    }

    // Typed questions: the video keeps playing until CineMate starts talking.
    holdMedia(video);
    turn.voice = speech.speak(reply, {
      ...voiceSettings,
      language: speakingLanguage(),
      apiBase: api.API_BASE,
    });
    statusDiv.innerText = "Speaking… (Esc to stop)";

    const outcome = await turn.voice.done;
    statusDiv.innerText = outcome === "stopped" ? "Stopped." : "Ready";
  } catch (err) {
    hideThinking();

    if (err?.name === "AbortError") {
      statusDiv.innerText = "Stopped.";
    } else {
      console.error(err);
      showError(err, "Error talking to AI.");
    }
  } finally {
    if (currentTurn === turn) currentTurn = null;
    releaseMedia();
    showStopButton(false);
    setBusy(false);
  }
}

async function askCineMate(message, { video, history, signal }) {
  const { subtitles, currentSeconds } = await getViewingContext(video);

  const data = await api.post(
    "/chat",
    {
      subtitles: context.forChat(subtitles, currentSeconds),
      message,
      personality: currentPersonality,
      history,
      episodeId: video?.videoId,
      videoTitle: video?.title,
      currentSeconds,
      allowSpoilers: !generalSettings.spoilerGuard,
    },
    { signal }
  );

  return data.reply;
}

// Saves the turn to that video's chat; draws it only if that chat is on screen.
function addMessage(sender, text, options = {}) {
  const videoId = options.videoId !== undefined ? options.videoId : chatVideoId;
  const turn = { role: sender === "You" ? "user" : "assistant", content: text };

  if (videoId === chatVideoId) {
    renderMessage(sender, text);
    conversationHistory.push(turn);
  }

  storage.appendHistory(videoId, turn);
}

function renderMessage(sender, text) {
  const div = document.createElement("div");
  div.className = sender === "You" ? "user" : "ai";
  div.innerHTML = escapeHtml(text);
  conversationDiv.appendChild(div);
  conversationDiv.scrollTop = conversationDiv.scrollHeight;
}

function renderConversation(history) {
  conversationDiv.innerHTML = "";

  if (history.length === 0) {
    renderMessage("CineMate", WELCOME_MESSAGE);
    return;
  }

  history.forEach((turn) => renderMessage(turn.role === "user" ? "You" : "CineMate", turn.content));
}

function startNewChat() {
  storage.clearHistory(chatVideoId);
  conversationHistory = [];
  renderConversation([]);
  statusDiv.innerText = "Ready";
  setView("chat");
}

function showThinking() {
  hideThinking();

  const div = document.createElement("div");
  div.id = "thinkingBubble";
  div.className = "thinking";
  div.innerHTML =
    '<span class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span> CineMate is thinking...';
  conversationDiv.appendChild(div);
  conversationDiv.scrollTop = conversationDiv.scrollHeight;
}

function hideThinking() {
  document.getElementById("thinkingBubble")?.remove();
}

// ---------- Summary ----------

// Shift-click "Generate summary" to rebuild it even if nothing changed.
async function generateSummary(event) {
  setBusy(true);
  const originalLabel = summaryBtn.innerHTML;
  summaryBtn.innerHTML = '<span class="spinner"></span>Generating...';

  const video = activeVideo;

  try {
    setView("summary");
    statusDiv.innerText = "Generating summary...";

    const { subtitles, currentSeconds } = await getViewingContext(video);
    // Spoiler guard on: only what you've reached. Off: everything captured.
    const visible = generalSettings.spoilerGuard ? context.upTo(subtitles, currentSeconds) : subtitles;

    if (visible.length === 0) {
      statusDiv.innerText = "No captions yet – turn on CC and play the video.";
      return;
    }

    const data = await api.post("/summarize", {
      subtitles: visible,
      episodeId: video?.videoId,
      videoTitle: video?.title,
      currentSeconds,
      force: Boolean(event?.shiftKey),
      allowSpoilers: !generalSettings.spoilerGuard,
    });

    memoryListCache.at = 0; // the Sessions tab should show the new summary

    if ((video?.videoId || null) !== chatVideoId) {
      statusDiv.innerText = `Summary saved for "${video?.title || "the previous video"}".`;
      return;
    }

    renderSummary(data.episodeMemory);

    const until = data.episodeMemory?.coverage?.endTime;
    statusDiv.innerText = until
      ? `Summary up to ${until}${data.cached ? " (no new captions)" : ""}`
      : "Ready";
  } catch (err) {
    console.error(err);
    showError(err, "Summary unavailable.");
  } finally {
    setBusy(false);
    summaryBtn.innerHTML = originalLabel;
  }
}

function resetSummaryView() {
  lastEpisodeMemory = null;
  hiddenMemory = null;

  spoilerGate.hidden = true;
  summaryContent.hidden = false;
  summaryNotice.hidden = true;

  summaryText.innerText = "No summary yet for this video – tap Generate summary.";
  themeChips.innerHTML = '<span class="chip">No themes yet</span>';
  eventsList.innerText = "No events generated yet.";
}

function renderSummary(memory, { savedAt } = {}) {
  if (!memory) return;

  lastEpisodeMemory = memory;
  hiddenMemory = null;
  spoilerGate.hidden = true;
  summaryContent.hidden = false;

  const until = memory.coverage?.endTime;
  const saved = savedAt ? ` · saved ${sessions.timeAgo(Date.parse(savedAt))}` : "";
  summaryNotice.hidden = !until;
  summaryNotice.innerText = until ? `Covers up to ${until}${saved}` : "";

  summaryText.innerText = memory.summary || "No summary returned.";
  themeChips.innerHTML = "";
  eventsList.innerHTML = "";

  const themes = memory.keyThemes || [];
  if (themes.length === 0) {
    themeChips.innerHTML = '<span class="chip">No themes yet</span>';
  } else {
    themes.forEach((theme) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerText = theme;
      themeChips.appendChild(chip);
    });
  }

  const events = memory.importantEvents || [];
  if (events.length === 0) {
    eventsList.innerText = "No events returned.";
  } else {
    events.forEach((event) => {
      const div = document.createElement("div");
      div.style.marginBottom = "8px";
      div.innerText = `${event.time || "00:00:00"} - ${event.description || ""}`;
      eventsList.appendChild(div);
    });
  }
}

function saveNotes() {
  if (!lastEpisodeMemory) {
    statusDiv.innerText = "Generate a summary first.";
    return;
  }

  const title = activeVideo?.title || "Untitled video";
  const until = lastEpisodeMemory.coverage?.endTime;

  const lines = [
    `CineMate Notes – ${title}`,
    until ? `(up to ${until})` : "",
    "",
    lastEpisodeMemory.summary || "",
    "",
    "Key Themes:",
    ...(lastEpisodeMemory.keyThemes || []).map((theme) => `- ${theme}`),
    "",
    "Important Events:",
    ...(lastEpisodeMemory.importantEvents || []).map(
      (event) => `- [${event.time || "00:00:00"}] ${event.description || ""}`
    ),
  ];

  const fileSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cinemate-${fileSlug || "notes"}.txt`;
  link.click();
  URL.revokeObjectURL(url);

  statusDiv.innerText = "Notes saved.";
}

// ---------- Sessions tab ----------

// Saved memories from the backend, reused for a short while.
async function getMemoryList(force) {
  const fresh = Date.now() - memoryListCache.at < MEMORY_LIST_CACHE_MS;
  if (fresh && !force) return memoryListCache;

  try {
    memoryListCache = { at: Date.now(), list: await api.listMemories(), failed: false };
  } catch {
    memoryListCache = { at: Date.now(), list: [], failed: true };
  }

  return memoryListCache;
}

async function renderSessions(force = false) {
  if (!force && Date.now() - sessionsRenderedAt < SESSIONS_REFRESH_MS) return;
  sessionsRenderedAt = Date.now();

  const [localSessions, memories] = await Promise.all([storage.listSessions(), getMemoryList(force)]);
  const items = sessions.mergeSessions(localSessions, memories.list, activeVideo?.videoId);

  sessionsList.innerHTML = "";

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.innerText = "No sessions yet – play a YouTube or Netflix video with captions on.";
    sessionsList.appendChild(empty);
  }

  items.forEach((item) => sessionsList.appendChild(buildSessionItem(item)));

  if (memories.failed) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.innerText = "Server offline – saved summaries aren't shown.";
    sessionsList.appendChild(note);
  }
}

function buildSessionItem(item) {
  const card = document.createElement("div");
  card.className = `session-item${item.isActive ? " current" : ""}`;

  const title = document.createElement("div");
  title.className = "session-title";
  title.title = item.title;
  title.innerText = `${item.icon} ${item.title}`;
  if (item.isActive) {
    const badge = document.createElement("span");
    badge.className = "now-badge";
    badge.innerText = "Now";
    title.appendChild(badge);
  }

  const meta = document.createElement("div");
  meta.className = "session-meta";
  meta.innerText = [
    `${item.count || 0} ${item.count === 1 ? "line" : "lines"}`,
    sessions.timeAgo(item.updatedAt),
    item.memory?.coveredUntil ? `summary to ${item.memory.coveredUntil}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  card.append(title, meta);

  // The current video's summary lives in the Summary tab (with the spoiler check).
  if (!item.isActive && item.memory?.summary) {
    const summary = document.createElement("div");
    summary.className = "session-summary";
    summary.innerText = item.memory.summary;
    card.appendChild(summary);
  }

  const actions = document.createElement("div");
  actions.className = "session-actions";

  if (item.url && !item.isActive) {
    const openBtn = document.createElement("button");
    openBtn.innerText = "Open";
    openBtn.addEventListener("click", () => chrome.tabs.create({ url: item.url }));
    actions.appendChild(openBtn);
  }

  const forgetBtn = document.createElement("button");
  forgetBtn.innerText = "Forget";
  forgetBtn.addEventListener("click", () => confirmForget(forgetBtn, item));
  actions.appendChild(forgetBtn);

  card.appendChild(actions);
  return card;
}

// Two taps instead of a confirm() dialog.
function confirmForget(button, item) {
  if (button.dataset.armed !== "true") {
    button.dataset.armed = "true";
    button.innerText = "Tap again to forget";
    setTimeout(() => {
      button.dataset.armed = "false";
      button.innerText = "Forget";
    }, 3000);
    return;
  }

  forgetSession(item);
}

async function forgetSession(item) {
  await storage.forgetSession(item.videoId);

  try {
    await api.deleteMemory(item.videoId);
  } catch (err) {
    console.warn("Could not delete saved memory:", err.message);
  }

  memoryListCache.at = 0;
  if (item.videoId === chatVideoId) await loadEpisode(item.videoId);

  statusDiv.innerText = `Forgot "${item.title}".`;
  renderSessions(true);
}

// ---------- Views ----------

function setView(view) {
  currentView = view;

  conversationDiv.style.display = view === "chat" ? "flex" : "none";
  summaryPanel?.classList.toggle("active", view === "summary");
  sessionsPanel?.classList.toggle("active", view === "sessions");

  chatTab?.classList.toggle("active", view === "chat");
  summaryTab?.classList.toggle("active", view === "summary");
  sessionsTab?.classList.toggle("active", view === "sessions");

  if (view === "sessions") renderSessions(true);
}

function setBusy(busy) {
  isBusy = busy;

  const quickActionButtons = Array.from(document.querySelectorAll("[data-message]"));
  const coolingDown = Date.now() < cooldownUntil;
  const aiButtons = [summaryBtn, sendBtn, ...quickActionButtons];

  [summaryBtn, sendBtn, saveNotesBtn, newChatBtn, ...personaButtons, ...quickActionButtons].forEach(
    (button) => {
      if (button) button.disabled = busy || (coolingDown && aiButtons.includes(button));
    }
  );

  if (!isListening) {
    talkBtn.disabled = busy || coolingDown;
  }
}

// ---------- Viewing context + errors ----------

// Captions for a video, plus where the viewer is in it right now.
// If the video's tab can't be reached, falls back to the last captured line.
async function getViewingContext(video) {
  if (!video) return { subtitles: [], currentSeconds: null };

  const subtitles = await storage.getSubtitles(video.videoId);
  const playback = await context.getPlayback(video);
  const lastLine = subtitles[subtitles.length - 1];

  const currentSeconds = playback ? playback.seconds : lastLine ? lastLine.seconds : null;

  return { subtitles, currentSeconds };
}

function showError(err, fallbackMessage) {
  const isApiError = err instanceof api.ApiError;

  if (isApiError && err.retryAfterSeconds && err.code !== "AI_DAILY_QUOTA") {
    startCooldown(err.retryAfterSeconds, err.message.replace(/ Try again.*$/, ""));
    return;
  }

  statusDiv.innerText = isApiError ? err.message : fallbackMessage;

  // Couldn't reach the server at all → show the offline banner straight away.
  if (isApiError && err.status === 0) checkStatus({ forceHealth: true });
}

// Rate limited: count down and keep the AI buttons off until it's over.
function startCooldown(seconds, reason) {
  cooldownUntil = Date.now() + seconds * 1000;
  clearInterval(cooldownTimer);

  const tick = () => {
    const left = Math.ceil((cooldownUntil - Date.now()) / 1000);

    if (left <= 0) {
      clearInterval(cooldownTimer);
      cooldownUntil = 0;
      statusDiv.innerText = "Ready";
      setBusy(false);
      return;
    }

    statusDiv.innerText = `${reason} Try again in ${left}s.`;
  };

  tick();
  cooldownTimer = setInterval(tick, 1000);
}

// ---------- Voice ----------

async function loadVoiceSettings() {
  voiceSettings = await storage.getVoiceSettings();
  updateHint();
}

function speakingLanguage() {
  return voiceSettings.language || navigator.language || "en-US";
}

function updateHint() {
  const noBrowserVoice = voiceSettings.input === "browser" && !listen.isBrowserSupported();
  voiceHint.innerText = noBrowserVoice ? "Voice input isn't available here – type your question" : DEFAULT_HINT;
}

// 🎙 starts listening; tapping it again finishes early and sends what you said.
async function toggleListening() {
  if (isListening) {
    listenSession?.stop();
    if (voiceSettings.input === "server") statusDiv.innerText = "Transcribing...";
    return;
  }

  if (isBusy) return;
  await startListening();
}

async function startListening() {
  const video = activeVideo;
  let transcript = "";
  let failed = false;

  holdMedia(video); // so the mic hears you, not the film
  listeningCancelled = false;
  isListening = true;
  updateMicButton();
  textInput.value = "";
  textInput.readOnly = true;
  textInput.classList.add("listening");
  statusDiv.innerText =
    voiceSettings.input === "server" ? "Recording… tap ■ when you're done." : "Listening…";

  try {
    listenSession = await listen.start(
      { ...voiceSettings, language: speakingLanguage(), apiBase: api.API_BASE },
      { onInterim: (text) => (textInput.value = text) }
    );
    ({ transcript } = await listenSession.result);
  } catch (err) {
    console.error(err);
    failed = true;
    statusDiv.innerText = err.message || "Voice input failed.";
  } finally {
    listenSession = null;
    isListening = false;
    updateMicButton();
    textInput.readOnly = false;
    textInput.classList.remove("listening");
  }

  if (!transcript) {
    releaseMedia();
    textInput.value = "";
    if (listeningCancelled) statusDiv.innerText = "Stopped.";
    else if (!failed) statusDiv.innerText = "I didn't catch that – try again or type your question.";
    return;
  }

  if (voiceSettings.autoSend) {
    textInput.value = "";
    await sendTextMessage(transcript); // keeps the video held until CineMate finishes
  } else {
    releaseMedia();
    textInput.value = transcript;
    textInput.focus();
    statusDiv.innerText = "Edit if you like, then press Enter.";
  }
}

function updateMicButton() {
  talkBtn.innerText = isListening ? "■" : "🎙";
  talkBtn.title = isListening ? "Finish talking" : "Talk to CineMate";
  talkBtn.classList.toggle("recording", isListening);
  talkBtn.disabled = !isListening && isBusy;
}

function showStopButton(visible) {
  stopBtn.hidden = !visible;
  talkBtn.hidden = visible;
}

// Stop button / Esc: stop listening, cancel the request, cut the voice off.
function stopEverything() {
  if (isListening) {
    listeningCancelled = true;
    listenSession?.cancel();
  }

  if (currentTurn) {
    currentTurn.abort.abort();
    currentTurn.voice?.stop();
  }

  releaseMedia();
}

// ---------- Pausing / turning down the video ----------

// Called when you start talking and again when CineMate starts speaking; the
// tab keeps the first hold, and the second one just restarts its 2-minute
// safety timer so a long reply isn't cut short.
function holdMedia(video) {
  if (!video || voiceSettings.whileTalking === "off") return;
  if (heldVideo && heldVideo.videoId !== video.videoId) releaseMedia();

  heldVideo = video;
  context.controlMedia(video, "hold", voiceSettings.whileTalking);
}

function releaseMedia() {
  if (!heldVideo) return;

  const video = heldVideo;
  heldVideo = null;
  context.controlMedia(video, "release");
}

// ---------- Settings (Week 5) ----------

async function loadGeneralSettings() {
  applyGeneralSettings(await storage.getSettings());
}

function applyGeneralSettings(settings) {
  const previousUrl = generalSettings.backendUrl;
  generalSettings = { ...storage.DEFAULT_SETTINGS, ...(settings || {}) };
  api.setBase(generalSettings.backendUrl);

  // New server address → check it straight away.
  if (generalSettings.backendUrl !== previousUrl) {
    checkStatus({ forceHealth: true });
  }
}

// ---------- Status banner (Week 5) ----------

function startStatusChecks() {
  checkStatus({ forceHealth: true });
  clearInterval(statusTimer);
  statusTimer = setInterval(() => {
    if (document.visibilityState === "visible") checkStatus();
  }, STATUS_CHECK_MS);
}

// Server offline? Video tab unreachable? No captions? → one banner.
async function checkStatus({ forceHealth = false } = {}) {
  if (forceHealth || Date.now() - lastHealthAt > HEALTH_CHECK_MS) {
    lastHealthAt = Date.now();
    try {
      lastHealth = await api.health();
      serverState = "ok";
    } catch {
      lastHealth = null;
      serverState = "offline";
    }
  }

  const { tab, captions } = await context.checkTab(activeVideo);
  const platformLabel = globalThis.CineMate.platforms?.byId(activeVideo?.platform)?.label;

  renderBanner(
    statusBanner.describeProblem({
      server: serverState,
      health: lastHealth,
      backendUrl: generalSettings.backendUrl,
      tab,
      captions,
      platformLabel,
    })
  );
}

function renderBanner(problem) {
  banner.hidden = !problem;
  bannerActionType = problem?.action || null;
  if (!problem) return;

  banner.className = `banner ${problem.level}`;
  bannerText.innerText = problem.text;
  bannerAction.hidden = !problem.action;
  bannerAction.innerText = problem.action === "refresh" ? "Refresh tab" : "Retry";
}

async function handleBannerAction() {
  if (bannerActionType === "refresh" && activeVideo?.tabId) {
    try {
      await chrome.tabs.reload(activeVideo.tabId);
      statusDiv.innerText = "Refreshing the video tab…";
    } catch {
      statusDiv.innerText = "That tab is closed – open the video again.";
    }
    setTimeout(() => checkStatus(), 3000);
    return;
  }

  checkStatus({ forceHealth: true });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.innerText = text;
  return div.innerHTML;
}