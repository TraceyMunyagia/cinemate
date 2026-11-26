// utils/speech.js
// CineMate's voice. Uses Chrome's built-in voice by default; the backend's
// pyttsx3 voice only when the output setting is "server" (falling back to
// Chrome's voice if the server can't do it).
//
// speak(text, settings) returns { done, stop } right away:
//   done -> Promise resolving to "finished" | "stopped" | "failed"
//   stop -> cuts CineMate off mid-sentence

(function (root) {
  const CineMate = (root.CineMate = root.CineMate || {});

  const MAX_CHUNK_CHARS = 180;
  const MS_PER_CHAR = 90; // generous speaking-time estimate for the watchdog

  // Chrome stops reading long utterances after ~15 seconds, so CineMate
  // speaks one sentence-sized chunk at a time.
  function splitForSpeech(text, maxLength = MAX_CHUNK_CHARS) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return [];

    const sentences = clean.match(/[^.!?…]+[.!?…]+["”')\]]*|[^.!?…]+$/g) || [clean];
    const chunks = [];
    let current = "";

    const pushCurrent = () => {
      if (current) chunks.push(current);
      current = "";
    };

    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!sentence) continue;

      if (sentence.length > maxLength) {
        pushCurrent();
        // Very long sentence: break it between words.
        let piece = "";
        for (const word of sentence.split(" ")) {
          if (piece && piece.length + word.length + 1 > maxLength) {
            chunks.push(piece);
            piece = word;
          } else {
            piece = piece ? `${piece} ${word}` : word;
          }
        }
        if (piece) chunks.push(piece);
      } else if (current && current.length + sentence.length + 1 > maxLength) {
        pushCurrent();
        current = sentence;
      } else {
        current = current ? `${current} ${sentence}` : sentence;
      }
    }

    pushCurrent();
    return chunks;
  }

  // Best voice for a language like "en-KE": exact match, then same base language.
  function pickVoice(language) {
    if (!language || !root.speechSynthesis?.getVoices) return null;

    const voices = root.speechSynthesis.getVoices();
    const wanted = language.toLowerCase();
    const base = wanted.split("-")[0];

    return (
      voices.find((voice) => voice.lang.toLowerCase() === wanted) ||
      voices.find((voice) => voice.lang.toLowerCase().split("-")[0] === base) ||
      null
    );
  }

  function speakWithBrowser(text, { language } = {}) {
    const synth = root.speechSynthesis;
    const chunks = splitForSpeech(text);

    let finish;
    const done = new Promise((resolve) => (finish = resolve));

    if (!synth || chunks.length === 0) {
      finish(synth ? "finished" : "failed");
      return { done, stop() {} };
    }

    synth.cancel(); // anything still being read from before

    const voice = pickVoice(language);
    let stopped = false;

    // Chrome occasionally never fires "end"; don't let that keep the video paused.
    const watchdog = setTimeout(() => finish("finished"), text.length * MS_PER_CHAR + 5000);
    done.then(() => clearTimeout(watchdog));

    chunks.forEach((chunk, index) => {
      const utterance = new root.SpeechSynthesisUtterance(chunk);
      if (voice) utterance.voice = voice;
      if (language) utterance.lang = language;

      if (index === chunks.length - 1) {
        utterance.onend = () => finish(stopped ? "stopped" : "finished");
      }
      utterance.onerror = (event) => {
        const interrupted = event?.error === "interrupted" || event?.error === "canceled";
        finish(stopped || interrupted ? "stopped" : "failed");
      };

      synth.speak(utterance);
    });

    return {
      done,
      stop() {
        stopped = true;
        synth.cancel();
        finish("stopped");
      },
    };
  }

  // Resolves with { done, stop } while the audio plays, or null if the
  // server says "use the browser's voice" (204).
  async function speakWithServer(text, apiBase, signal) {
    const response = await fetch(`${apiBase}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });

    if (response.status === 204) return null;
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Server voice failed (${response.status}).`);
    }

    const audioUrl = URL.createObjectURL(await response.blob());
    const audio = new root.Audio(audioUrl);

    let finish;
    const done = new Promise((resolve) => (finish = resolve));
    done.then(() => URL.revokeObjectURL(audioUrl));

    audio.addEventListener("ended", () => finish("finished"), { once: true });
    audio.addEventListener("error", () => finish("failed"), { once: true });
    await audio.play();

    return {
      done,
      stop() {
        audio.pause();
        finish("stopped");
      },
    };
  }

  // settings: { output: "browser" | "server" | "off", language, apiBase }
  function speak(text, settings = {}) {
    let finish;
    const done = new Promise((resolve) => (finish = resolve));
    const abort = new AbortController();
    let inner = null;
    let stopped = false;

    (async () => {
      if (settings.output === "off") return finish("finished");

      if (settings.output === "server") {
        try {
          inner = await speakWithServer(text, settings.apiBase, abort.signal);
        } catch (error) {
          if (stopped) return finish("stopped");
          console.warn("Server voice failed, using the browser's voice:", error.message);
        }
      }

      if (stopped) return finish("stopped");
      if (!inner) inner = speakWithBrowser(text, settings);
      finish(await inner.done);
    })();

    return {
      done,
      stop() {
        stopped = true;
        abort.abort();
        inner?.stop();
        finish("stopped");
      },
    };
  }

  CineMate.speech = { speak, splitForSpeech, pickVoice };
})(globalThis);