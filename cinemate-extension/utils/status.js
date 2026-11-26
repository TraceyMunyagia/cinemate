// utils/status.js
// Turns what the panel knows about the server and the video tab into one
// banner message (or none). No Chrome or DOM calls, so it's testable in Node.
//
// describeProblem({ server, health, backendUrl, tab, captions, platformLabel })
//   server:   "ok" | "offline" | "unknown"
//   health:   the /health reply (for mock mode / missing key)
//   tab:      "ok" | "unreachable" | "none" (no video open)
//   captions: "ok" | "waiting" | "missing"
// -> { level: "error" | "warning" | "info", text, action: "retry" | "refresh" | null } or null

(function (root) {
  const CineMate = (root.CineMate = root.CineMate || {});

  function describeProblem({ server, health, backendUrl, tab, captions, platformLabel } = {}) {
    if (server === "offline") {
      return {
        level: "error",
        text: `CineMate server is offline (${backendUrl}). Start it with "npm start" in cinemate-backend.`,
        action: "retry",
      };
    }

    if (tab === "unreachable") {
      return {
        level: "warning",
        text: "Can't reach the video tab – refresh it (needed after CineMate is updated or reloaded).",
        action: "refresh",
      };
    }

    if (captions === "missing") {
      return {
        level: "warning",
        text: `No captions detected – turn on subtitles (CC) in the ${platformLabel || "video"} player.`,
        action: null,
      };
    }

    const ai = health?.ai;
    if (ai && !ai.mock && !ai.keySet) {
      return {
        level: "warning",
        text: `No API key for ${ai.provider} – add it to cinemate-backend/.env and restart the server.`,
        action: null,
      };
    }

    if (ai?.mock) {
      return { level: "info", text: "Mock mode – replies are canned (USE_MOCK_AI=true).", action: null };
    }

    return null;
  }

  CineMate.status = { describeProblem };
})(globalThis);