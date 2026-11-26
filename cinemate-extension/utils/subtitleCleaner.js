// utils/subtitleCleaner.js
// Turns the caption text read off the page once per second into clean lines.
//
// YouTube captions "roll": a line grows word by word, then scrolls up while
// the next one grows under it. Read once a second, that looks like:
//
//   "So where"
//   "So where were you last night?"
//   "So where were you last night? I told you"     <- same window, growing
//   "I told you, I was at the studio. Until"       <- scrolled: new window
//
// A "window" is a run of frames where each one starts with the one before.
// Each window's new words (the part not already in the transcript) become
// one entry, updated as the window grows. Blank frames and ♪ are skipped, and
// text already captured nearby (e.g. after seeking back) isn't added twice.

(function (root) {
  const CineMate = (root.CineMate = root.CineMate || {});

  const MIN_OVERLAP_WORDS = 2; // shorter matches are too likely to be chance
  const DUPLICATE_WINDOW_SECONDS = 20; // how far around a seek to look for repeats
  const MAX_ENTRIES = 5000;

  // "  ♪ Hello   there ♪ " -> "Hello there"; "[Music]" -> ""
  function normalize(text) {
    return String(text || "")
      .replace(/[♪♫♬]/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Lowercase, no punctuation – for comparing words, not for display.
  const comparable = (word) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
  const words = (text) => normalize(text).split(" ").filter(Boolean);
  const flatten = (text) => words(text).map(comparable).filter(Boolean).join(" ");

  // How many words at the end of `before` repeat at the start of `after`
  // ("a b c d", "c d e" -> 2). Returns 0 below minWords.
  function countOverlapWords(before, after, minWords = MIN_OVERLAP_WORDS) {
    const a = words(before).map(comparable);
    const b = words(after).map(comparable);

    for (let size = Math.min(a.length, b.length); size >= minWords; size--) {
      let match = true;
      for (let i = 0; i < size; i++) {
        if (a[a.length - size + i] !== b[i]) {
          match = false;
          break;
        }
      }
      if (match) return size;
    }

    return 0;
  }

  function createTracker(initialEntries = []) {
    const time = CineMate.time;
    let entries = [...initialEntries];
    let win = null; // { frame, overlap, entry } for the window being read

    // Text the viewer has already seen around this point in the video.
    function isDuplicate(text, seconds) {
      const needle = flatten(text);
      if (!needle) return true;

      const nearby = entries.filter(
        (entry, index) =>
          index >= entries.length - 3 ||
          Math.abs((entry.seconds || 0) - seconds) <= DUPLICATE_WINDOW_SECONDS
      );

      // Join neighbours so a line split across two entries still matches.
      const haystack = nearby.map((entry) => flatten(entry.text)).join(" | ");
      const joined = nearby.map((entry) => flatten(entry.text)).join(" ");
      return haystack.includes(needle) || joined.includes(needle);
    }

    function transcriptTail() {
      return entries
        .slice(-2)
        .map((entry) => entry.text)
        .join(" ");
    }

    // Returns true when entries changed (so the caller knows to save).
    function push(rawText, rawSeconds) {
      const frame = normalize(rawText);
      if (!frame) return false; // gap between lines, or just ♪

      const seconds = Math.max(0, Math.floor(Number(rawSeconds) || 0));

      if (win && frame === win.frame) return false;

      // Same window growing, or a new one (scrolled, new line, or a seek)?
      if (!win || !frame.startsWith(win.frame)) {
        win = { overlap: countOverlapWords(transcriptTail(), frame), entry: null };
      }
      win.frame = frame;

      const fresh = words(frame).slice(win.overlap).join(" ");
      if (!fresh) return false;

      if (win.entry) {
        if (win.entry.text === fresh) return false;
        win.entry.text = fresh;
        return true;
      }

      if (isDuplicate(fresh, seconds)) return false;

      win.entry = { time: time.formatTime(seconds), seconds, text: fresh };
      entries.push(win.entry);
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
      return true;
    }

    function reset(nextEntries = []) {
      entries = [...nextEntries];
      win = null;
    }

    return {
      get entries() {
        return entries;
      },
      push,
      reset,
    };
  }

  CineMate.captions = { createTracker, normalize, countOverlapWords };
})(globalThis);
