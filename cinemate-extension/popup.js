const talkBtn = document.getElementById("talkBtn");
const statusDiv = document.getElementById("status");
const conversationDiv = document.getElementById("conversation");
const voiceHint = document.getElementById("voiceHint");
const summaryBtn = document.getElementById("summaryBtn");
const chatTab = document.getElementById("chatTab");
const summaryTab = document.getElementById("summaryTab");
const summaryPanel = document.getElementById("summaryPanel");
const summaryText = document.getElementById("summaryText");
const themeChips = document.getElementById("themeChips");
const eventsList = document.getElementById("eventsList");
const saveNotesBtn = document.getElementById("saveNotesBtn");
const newChatBtn = document.getElementById("newChatBtn");
const personaButtons = document.querySelectorAll(".persona-pill");
const videoTitleDiv = document.getElementById("videoTitle");
const clearCaptionsBtn = document.getElementById("clearCaptionsBtn");

const { storage } = globalThis.CineMate;

const HISTORY_KEY = "cinemateHistory";
const PERSONALITY_KEY = "cinematePersonality";
const DEFAULT_PERSONALITY = "casualFriend";

let mediaRecorder = null;
let audioChunks = [];
let micStream = null;
let isRecording = false;
let lastEpisodeMemory = null;
let conversationHistory = [];
let currentPersonality = DEFAULT_PERSONALITY;
let activeVideo = null;

restoreState();
refreshVideoInfo();
storage.watch(handleStorageChange);
restoreState();

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
saveNotesBtn?.addEventListener("click", saveNotes);
newChatBtn?.addEventListener("click", startNewChat);
clearCaptionsBtn?.addEventListener("click", clearCaptions);

personaButtons.forEach((button) => {
  button.addEventListener("click", () => setPersonality(button.dataset.personality));
});

function setPersonality(personality) {
  currentPersonality = personality;

  personaButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.personality === personality);
  });

  chrome.storage.local.set({ [PERSONALITY_KEY]: personality });
}

function restoreState() {
  chrome.storage.local.get([HISTORY_KEY, PERSONALITY_KEY], (result) => {
    setPersonality(result[PERSONALITY_KEY] || DEFAULT_PERSONALITY);

    conversationHistory = Array.isArray(result[HISTORY_KEY]) ? result[HISTORY_KEY] : [];

    if (conversationHistory.length > 0) {
      conversationDiv.innerHTML = "";
      conversationHistory.forEach((turn) => {
        addMessage(turn.role === "user" ? "You" : "CineMate", turn.content, { persist: false });
      });
    }
  });
}

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
    console.error(err);
    statusDiv.innerText = "Could not access microphone.";
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

async function sendTextMessage(message) {
  setBusy(true);

  try {
    setView("chat");
    addMessage("You", message);
    statusDiv.innerText = "Thinking...";
    showThinking();

    const reply = await askCineMate(message);

    hideThinking();
    addMessage("CineMate", reply);
    await speak(reply);
    statusDiv.innerText = "Ready";
  } catch (err) {
    console.error(err);
    hideThinking();
    statusDiv.innerText = "Error talking to AI.";
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  const quickActionButtons = document.querySelectorAll("[data-message]");

  [summaryBtn, saveNotesBtn, newChatBtn, ...personaButtons, ...quickActionButtons].forEach(
    (button) => {
      if (button) button.disabled = isBusy;
    }
  );

  if (!isRecording) {
    talkBtn.disabled = isBusy;
  }
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

async function transcribeAudio(audioBlob) {
  const response = await fetch("http://localhost:3000/transcribe", {
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

async function askCineMate(message) {
  const subtitles = await getStoredSubtitles();

  const response = await fetch("http://localhost:3000/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      subtitles,
      message,
      personality: currentPersonality,
      history: conversationHistory.slice(0, -1),
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || "Chat failed.");
  }

  return data.reply;
}

async function getStoredSubtitles() {
  activeVideo = await storage.getActiveVideo();
  return activeVideo ? storage.getSubtitles(activeVideo.videoId) : [];
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

function addMessage(sender, text, options = {}) {
  const div = document.createElement("div");
  div.className = sender === "You" ? "user" : "ai";
  div.innerHTML = escapeHtml(text);
  conversationDiv.appendChild(div);
  conversationDiv.scrollTop = conversationDiv.scrollHeight;

  if (options.persist !== false) {
    conversationHistory.push({ role: sender === "You" ? "user" : "assistant", content: text });
    chrome.storage.local.set({ [HISTORY_KEY]: conversationHistory });
  }
}

async function speak(text) {
  try {
    const response = await fetch("http://localhost:3000/tts", {
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

async function generateSummary() {
  setBusy(true);
  const originalLabel = summaryBtn.innerHTML;
  summaryBtn.innerHTML = '<span class="spinner"></span>Generating...';

  try {
    setView("summary");
    statusDiv.innerText = "Generating summary...";

    const subtitles = await getStoredSubtitles();

    if (subtitles.length === 0) {
      statusDiv.innerText = "No captions yet – turn on CC and play the video.";
      return;
    }
    const response = await fetch("http://localhost:3000/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ subtitles }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Summary failed.");
    }

    renderSummary(data.episodeMemory);
    statusDiv.innerText = "Ready";
  } catch (err) {
    console.error(err);
    statusDiv.innerText = "Summary unavailable.";
  } finally {
    setBusy(false);
    summaryBtn.innerHTML = originalLabel;
  }
}

function renderSummary(memory) {
  if (!memory) return;

  lastEpisodeMemory = memory;
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

  const lines = [
    "CineMate Episode Notes",
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

  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "cinemate-notes.txt";
  link.click();
  URL.revokeObjectURL(url);

  statusDiv.innerText = "Notes saved.";
}

function startNewChat() {
  conversationDiv.innerHTML =
    '<div class="ai">Ask me about the scene, character choices, conflicts, or what just happened.</div>';
  conversationHistory = [];
  chrome.storage.local.set({ [HISTORY_KEY]: [] });
  statusDiv.innerText = "Ready";
  setView("chat");
}

function setView(view) {
  const isSummary = view === "summary";

  conversationDiv.style.display = isSummary ? "none" : "flex";
  if (summaryPanel) {
    summaryPanel.classList.toggle("active", isSummary);
  }
  chatTab?.classList.toggle("active", !isSummary);
  summaryTab?.classList.toggle("active", isSummary);
}
// ---------- Active video (Week 1) ----------

async function refreshVideoInfo() {
  activeVideo = await storage.getActiveVideo();

  if (!activeVideo) {
    videoTitleDiv.innerText = "No video detected – open YouTube or Netflix";
    videoTitleDiv.title = "";
    clearCaptionsBtn.disabled = true;
    return;
  }

  const subtitles = await storage.getSubtitles(activeVideo.videoId);
  const name = activeVideo.title || "Untitled video";
  const lines = subtitles.length === 1 ? "1 line" : `${subtitles.length} lines`;

  videoTitleDiv.innerText = `${name} · ${lines}`;
  videoTitleDiv.title = name;
  clearCaptionsBtn.disabled = subtitles.length === 0;
}

function handleStorageChange(changes) {
  const activeChanged = Boolean(changes[storage.KEYS.ACTIVE]);
  const captionsChanged =
    activeVideo && Boolean(changes[storage.subtitleKey(activeVideo.videoId)]);

  if (activeChanged || captionsChanged) refreshVideoInfo();
}

async function clearCaptions() {
  if (!activeVideo) return;

  await storage.clearSubtitles(activeVideo.videoId);
  statusDiv.innerText = "Captions cleared for this video.";
}
