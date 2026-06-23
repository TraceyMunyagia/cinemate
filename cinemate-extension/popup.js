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

let mediaRecorder = null;
let audioChunks = [];
let micStream = null;
let isRecording = false;

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
    if (voiceHint) voiceHint.innerText = "Tap to speak";
  }
}

async function sendTextMessage(message) {
  try {
    setView("chat");
    addMessage("You", message);
    statusDiv.innerText = "Thinking...";

    const reply = await askCineMate(message);

    addMessage("CineMate", reply);
    await speak(reply);
    statusDiv.innerText = "Ready";
  } catch (err) {
    console.error(err);
    statusDiv.innerText = "Error talking to AI.";
  }
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
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || "Chat failed.");
  }

  return data.reply;
}

function getStoredSubtitles() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["subtitles"], (result) => {
      resolve(result.subtitles || []);
    });
  });
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

function addMessage(sender, text) {
  const div = document.createElement("div");
  div.className = sender === "You" ? "user" : "ai";
  div.innerHTML = escapeHtml(text);
  conversationDiv.appendChild(div);
  conversationDiv.scrollTop = conversationDiv.scrollHeight;
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
  try {
    setView("summary");
    statusDiv.innerText = "Generating summary...";

    const subtitles = await getStoredSubtitles();
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
  }
}

function renderSummary(memory) {
  if (!memory) return;

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

function setView(view) {
  const isSummary = view === "summary";

  conversationDiv.style.display = isSummary ? "none" : "flex";
  if (summaryPanel) {
    summaryPanel.classList.toggle("active", isSummary);
  }
  chatTab?.classList.toggle("active", !isSummary);
  summaryTab?.classList.toggle("active", isSummary);
}
