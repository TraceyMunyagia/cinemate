// utils/listen.js
// Turns your voice into text.
//  - "browser" (default): Chrome's built-in speech recognition. Shows words
//    as you speak and stops by itself when you stop talking. Chrome sends
//    the audio to Google's speech service, so it needs an internet connection.
//  - "server": records audio and sends it to the backend (local Whisper or
//    OpenAI Whisper). Tap again to stop recording.
//
// const session = await listen.start(settings, { onInterim });
//   session.result -> Promise<{ transcript, source }>
//   session.stop() -> finish now and use what was heard
//   session.cancel() -> throw it away

(function (root) {
  const CineMate = (root.CineMate = root.CineMate || {});

  const MAX_RECORDING_MS = 30000;

  class ListenError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "ListenError";
      this.code = code;
    }
  }

  const MESSAGES = {
    unsupported: "This browser has no speech recognition – type instead, or set voice input to \"server\".",
    "not-allowed":
      "The microphone is blocked for CineMate. Allow it in chrome://settings/content/microphone, then try again.",
    "service-not-allowed":
      "The microphone is blocked for CineMate. Allow it in chrome://settings/content/microphone, then try again.",
    "audio-capture": "No microphone was found.",
    network: "Chrome's speech recognition needs an internet connection.",
    "language-not-supported": "Speech recognition doesn't support that language – change it in the voice settings.",
  };

  const toListenError = (code) =>
    new ListenError(code, MESSAGES[code] || `Speech recognition stopped (${code}).`);

  function getRecognitionClass() {
    return root.SpeechRecognition || root.webkitSpeechRecognition || null;
  }

  // Speech recognition in an extension window only works once the page has
  // microphone permission, so ask for it first (this shows Chrome's prompt
  // the very first time).
  let micAllowed = false;
  async function ensureMicAccess() {
    if (micAllowed) return;

    try {
      const stream = await root.navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      micAllowed = true;
    } catch (error) {
      if (error?.name === "NotFoundError") throw toListenError("audio-capture");
      throw toListenError("not-allowed");
    }
  }

  // ---------- Browser speech recognition ----------

  async function listenWithBrowser({ language }, { onInterim } = {}) {
    const Recognition = getRecognitionClass();
    if (!Recognition) throw toListenError("unsupported");

    await ensureMicAccess();

    const recognition = new Recognition();
    recognition.lang = language || root.navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false; // ends by itself after you stop talking
    recognition.maxAlternatives = 1;

    let finalText = "";
    let cancelled = false;

    const result = new Promise((resolve, reject) => {
      recognition.onresult = (event) => {
        let interim = "";
        finalText = "";

        for (let i = 0; i < event.results.length; i++) {
          const piece = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalText += piece;
          else interim += piece;
        }

        onInterim?.(`${finalText} ${interim}`.trim());
      };

      recognition.onerror = (event) => {
        if (event.error === "no-speech") return; // onend follows with ""
        if (event.error === "aborted" && cancelled) return;
        reject(toListenError(event.error));
      };

      recognition.onend = () => {
        resolve({ transcript: cancelled ? "" : finalText.trim(), source: "browser" });
      };
    });

    recognition.start();

    return {
      result,
      stop: () => recognition.stop(),
      cancel: () => {
        cancelled = true;
        recognition.abort();
      },
    };
  }

  // ---------- Record + backend Whisper ----------

  function pickMimeType() {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    return types.find((type) => root.MediaRecorder?.isTypeSupported(type)) || "";
  }

  async function listenWithServer({ apiBase }) {
    if (!root.MediaRecorder) throw toListenError("unsupported");

    let stream;
    try {
      stream = await root.navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      throw toListenError(error?.name === "NotFoundError" ? "audio-capture" : "not-allowed");
    }

    const mimeType = pickMimeType();
    const recorder = new root.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    let cancelled = false;

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });

    const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
    const limit = setTimeout(() => recorder.state !== "inactive" && recorder.stop(), MAX_RECORDING_MS);

    recorder.start();

    const result = (async () => {
      await stopped;
      clearTimeout(limit);
      stream.getTracks().forEach((track) => track.stop());

      if (cancelled || chunks.length === 0) return { transcript: "", source: "server" };

      const audio = new Blob(chunks, { type: mimeType || "audio/webm" });
      const response = await fetch(`${apiBase}/transcribe`, {
        method: "POST",
        headers: { "Content-Type": audio.type || "audio/webm" },
        body: audio,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new ListenError("server", data.error || "Transcription failed.");
      }

      return { transcript: String(data.transcript || "").trim(), source: "server" };
    })();

    const stopRecorder = () => recorder.state !== "inactive" && recorder.stop();

    return {
      result,
      stop: stopRecorder,
      cancel: () => {
        cancelled = true;
        stopRecorder();
      },
    };
  }

  // settings: { input: "browser" | "server", language, apiBase }
  function start(settings = {}, callbacks = {}) {
    return settings.input === "server"
      ? listenWithServer(settings)
      : listenWithBrowser(settings, callbacks);
  }

  CineMate.listen = {
    start,
    ListenError,
    isBrowserSupported: () => Boolean(getRecognitionClass()),
  };
})(globalThis);