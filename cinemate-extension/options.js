// options.js
// The CineMate settings page (chrome://extensions → CineMate → Details →
// Extension options, or ⚙️ in the panel). Every change is saved straight
// away; the panel picks it up live through chrome.storage.

const { storage, api } = globalThis.CineMate;

const $ = (id) => document.getElementById(id);

const fields = {
  backendUrl: $("backendUrl"),
  personality: $("personality"),
  spoilerGuard: $("spoilerGuard"),
  voiceInput: $("voiceInput"),
  voiceOutput: $("voiceOutput"),
  language: $("language"),
  whileTalking: $("whileTalking"),
  autoSend: $("autoSend"),
};

const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
let savedNoteTimer = null;

init();

async function init() {
  $("version").innerText = `Version ${chrome.runtime.getManifest().version}.`;
  $("browserLanguage").innerText = navigator.language || "en-US";

  // Persona options come from storage.js so the panel and this page match.
  storage.PERSONALITIES.forEach(({ id, label }) => {
    const option = document.createElement("option");
    option.value = id;
    option.innerText = label;
    fields.personality.appendChild(option);
  });

  await loadIntoForm();
  bindEvents();
}

async function loadIntoForm() {
  const [settings, voice, personality] = await Promise.all([
    storage.getSettings(),
    storage.getVoiceSettings(),
    storage.getPersonality(),
  ]);

  fields.backendUrl.value = settings.backendUrl;
  fields.spoilerGuard.checked = settings.spoilerGuard;
  fields.personality.value = personality;

  fields.voiceInput.value = voice.input;
  fields.voiceOutput.value = voice.output;
  fields.language.value = voice.language;
  fields.whileTalking.value = voice.whileTalking;
  fields.autoSend.checked = voice.autoSend;
}

function bindEvents() {
  // Server address: saved on the button, Enter, or leaving the field.
  $("saveUrlBtn").addEventListener("click", saveBackendUrl);
  fields.backendUrl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveBackendUrl();
  });
  fields.backendUrl.addEventListener("change", saveBackendUrl);
  $("testBtn").addEventListener("click", testConnection);

  fields.personality.addEventListener("change", async () => {
    await storage.savePersonality(fields.personality.value);
    showSaved();
  });

  fields.spoilerGuard.addEventListener("change", async () => {
    await storage.saveSettings({ spoilerGuard: fields.spoilerGuard.checked });
    showSaved();
  });

  const voiceSelects = {
    voiceInput: "input",
    voiceOutput: "output",
    whileTalking: "whileTalking",
  };
  Object.entries(voiceSelects).forEach(([field, key]) => {
    fields[field].addEventListener("change", async () => {
      await storage.saveVoiceSettings({ [key]: fields[field].value });
      showSaved();
    });
  });

  fields.autoSend.addEventListener("change", async () => {
    await storage.saveVoiceSettings({ autoSend: fields.autoSend.checked });
    showSaved();
  });

  fields.language.addEventListener("change", saveLanguage);
}

async function saveBackendUrl() {
  const error = $("urlError");

  try {
    const settings = await storage.saveSettings({ backendUrl: fields.backendUrl.value });
    fields.backendUrl.value = settings.backendUrl; // show the cleaned-up version
    error.hidden = true;
    showSaved();
  } catch (err) {
    error.innerText = err.message;
    error.hidden = false;
  }
}

async function saveLanguage() {
  const value = fields.language.value.trim();
  const error = $("languageError");

  if (value && !LANGUAGE_PATTERN.test(value)) {
    error.innerText = "Use a language code like en-KE, en-US or sw-KE – or leave it empty.";
    error.hidden = false;
    return;
  }

  error.hidden = true;
  await storage.saveVoiceSettings({ language: value });
  showSaved();
}

// Checks /health and /voice/status on the address in the box.
async function testConnection() {
  const result = $("testResult");
  const button = $("testBtn");
  const url = storage.normalizeBackendUrl(fields.backendUrl.value);

  result.hidden = false;

  if (!url) {
    result.innerHTML = '<span class="bad">✗ That doesn\'t look like a server address.</span>';
    return;
  }

  button.disabled = true;
  result.innerText = `Checking ${url}…`;
  api.setBase(url);

  try {
    const health = await api.health();
    const ai = health.ai || {};
    const lines = [
      `<span class="ok">✓ Connected</span> to ${escapeHtml(url)} (server ${escapeHtml(health.version || "?")})`,
      ai.mock
        ? "AI: mock mode – replies are canned (USE_MOCK_AI=true)"
        : `AI: ${escapeHtml(ai.provider)} · ${escapeHtml(ai.model)} · ${
            ai.keySet ? '<span class="ok">API key set</span>' : '<span class="bad">API key missing in .env</span>'
          }`,
    ];

    try {
      const voice = await api.voiceStatus();
      lines.push(describeVoice("Server listening (Whisper)", voice.transcription));
      lines.push(describeVoice("Server voice (pyttsx3)", voice.speech));
    } catch {
      lines.push("Server voice: couldn't check.");
    }

    result.innerHTML = lines.join("<br />");
  } catch (err) {
    result.innerHTML = `<span class="bad">✗ ${escapeHtml(err.message)}</span><br />Start it with <code>cd cinemate-backend && npm start</code>.`;
  } finally {
    button.disabled = false;
  }
}

function describeVoice(label, status) {
  if (!status) return `${label}: unknown`;
  return status.available
    ? `${label}: <span class="ok">ready</span>`
    : `${label}: <span class="bad">not available</span> – ${escapeHtml(status.problem || "")}`;
}

function showSaved() {
  const note = $("savedNote");
  note.hidden = false;
  clearTimeout(savedNoteTimer);
  savedNoteTimer = setTimeout(() => (note.hidden = true), 1500);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.innerText = String(text);
  return div.innerHTML;
}