// popup.js
// The CineMate discussion panel: chat, voice, summary and sessions.
// Each video has its own chat and saved memory, and the panel follows
// whichever video is active (the tab you clicked 🎬 in or switched to last).

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

const { storage, context, api, sessions, time } = globalThis.CineMate;

const PERSONALITY_KEY = "cinematePersonality";
const DEFAULT_PERSONALITY = "casualFriend";
const WELCOME_MESSAGE = "Ask me about the scene, character choices, conflicts, or what just happened.";
const SESSIONS_REFRESH_MS = 10000; // re-draw the Sessions tab at most this often
const MEMORY_LIST_CACHE_MS = 30000; // how long to reuse GET /memory

// ---------- State ----------

let mediaRecorder = null;
let audioChunks = [];
let micStream = null;
let isRecording = false;

let currentPersonality = DEFAULT_PERSONALITY;
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
refreshVideoInfo();
storage.watch(handleStorageChange);

talkBtn.addEventListener("click", async () => {
  if (isRecording) {
    stopRecording();
    return;
  }

  await startRecording();
});

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

function setPersonality(personality) {
  currentPersonality = personality;

  personaButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.personality === personality);
  });

  chrome.storage.local.set({ [PERSONALITY_KEY]: personality });
}

function restorePersonality() {
  chrome.storage.local.get([PERSONALITY_KEY], (result) => {
    setPersonality(result[PERSONALITY_KEY] || DEFAULT_PERSONALITY);
  });
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
  }

  if (currentView === "sessions") renderSessions();
}

function handleStorageChange(changes) {
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

  if (sessions.isMemoryAhead(record.episodeMemory, currentSeconds)) {
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
  setBusy(true);

  // The reply belongs to this video's chat, even if you switch tabs meanwhile.
  const video = activeVideo;
  const videoId = chatVideoId;
  const history = conversationHistory.slice();

  try {
    setView("chat");
    addMessage("You", message, { videoId });
    statusDiv.innerText = "Thinking...";
    showThinking();

    const reply = await askCineMate(message, { video, history });

    hideThinking();
    addMessage("CineMate", reply, { videoId });

    if (videoId === chatVideoId) {
      await speak(reply);
      statusDiv.innerText = "Ready";
    } else {
      statusDiv.innerText = `Reply saved to the chat for "${video?.title || "the previous video"}".`;
    }
  } catch (err) {
    console.error(err);
    hideThinking();
    showError(err, "Error talking to AI.");
  } finally {
    setBusy(false);
  }
}

async function askCineMate(message, { video, history }) {
  const { subtitles, currentSeconds } = await getViewingContext(video);

  const data = await api.post("/chat", {
    subtitles: context.forChat(subtitles, currentSeconds),
    message,
    personality: currentPersonality,
    history,
    episodeId: video?.videoId,
    videoTitle: video?.title,
    currentSeconds,
  });

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
    const visible = context.upTo(subtitles, currentSeconds);

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

function setBusy(isBusy) {
  const quickActionButtons = Array.from(document.querySelectorAll("[data-message]"));
  const coolingDown = Date.now() < cooldownUntil;
  const aiButtons = [summaryBtn, ...quickActionButtons];

  [summaryBtn, saveNotesBtn, newChatBtn, ...personaButtons, ...quickActionButtons].forEach(
    (button) => {
      if (button) button.disabled = isBusy || (coolingDown && aiButtons.includes(button));
    }
  );

  if (!isRecording) {
    talkBtn.disabled = isBusy || coolingDown;
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

async function startRecording() {
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      statusDiv.innerText = "Voice recording is not supported in this browser.";
      return;
    }

    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    const mimeType = getSupportedMimeType();
    const recorderOptions = mimeType ? { mimeType } : undefined;
    mediaRecorder = new MediaRecorder(micStream, recorderOptions);

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("stop", handleRecordingStop);
    mediaRecorder.start();

    isRecording = true;
    talkBtn.innerText = "■";
    talkBtn.classList.add("recording");
    statusDiv.innerText = "Listening...";
    if (voiceHint) voiceHint.innerText = "Tap to stop";
  } catch (err) {
    stopMicStream();
    console.warn(`Microphone unavailable (${err.name}): ${err.message}`);
    statusDiv.innerText =
      err.name === "NotAllowedError"
        ? "Microphone blocked – allow it for CineMate in Chrome's site settings."
        : err.name === "NotFoundError"
          ? "No microphone found."
          : "Could not access microphone.";
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;

  statusDiv.innerText = "Transcribing...";
  mediaRecorder.stop();
  isRecording = false;
  talkBtn.innerText = "🎙";
  talkBtn.classList.remove("recording");
  if (voiceHint) voiceHint.innerText = "Processing...";
}

async function handleRecordingStop() {
  stopMicStream();
  setBusy(true);

  try {
    const audioBlob = new Blob(audioChunks, {
      type: getSupportedMimeType(),
    });

    const transcript = await transcribeAudio(audioBlob);

    if (!transcript) {
      statusDiv.innerText = "I could not hear anything clearly.";
      return;
    }

    statusDiv.innerText = `You said: "${transcript}"`;
    await sendTextMessage(transcript);
  } catch (err) {
    console.error(err);
    statusDiv.innerText = "Error talking to AI.";
  } finally {
    setBusy(false);
    if (voiceHint) voiceHint.innerText = "Tap to speak";
  }
}

async function transcribeAudio(audioBlob) {
  const response = await fetch(`${api.API_BASE}/transcribe`, {
    method: "POST",
    headers: {
      "Content-Type": audioBlob.type || "audio/webm",
    },
    body: audioBlob,
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || "Transcription failed.");
  }

  return data.transcript.trim();
}

function getSupportedMimeType() {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];

  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function stopMicStream() {
  if (!micStream) return;

  micStream.getTracks().forEach((track) => track.stop());
  micStream = null;
}

async function speak(text) {
  try {
    const response = await fetch(`${api.API_BASE}/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (response.status === 204) {
      speakWithBrowserTts(text);
      return;
    }

    if (!response.ok) {
      throw new Error("Local TTS request failed.");
    }

    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    audio.addEventListener("ended", () => URL.revokeObjectURL(audioUrl), {
      once: true,
    });

    await audio.play();
  } catch (err) {
    console.warn("Falling back to browser TTS:", err);
    speakWithBrowserTts(text);
  }
}

function speakWithBrowserTts(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.innerText = text;
  return div.innerHTML;
}