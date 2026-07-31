class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireSubtitles(subtitles) {
  if (!subtitles || !Array.isArray(subtitles) || subtitles.length === 0) {
    throw new HttpError(400, "Invalid or missing subtitles. Expected a non-empty array.");
  }
}

function optionalSubtitles(subtitles) {
  if (subtitles !== undefined && !Array.isArray(subtitles)) {
    throw new HttpError(400, "Invalid subtitles. Expected an array.");
  }
}

function requireMessage(message) {
  if (!message || typeof message !== "string" || message.trim() === "") {
    throw new HttpError(400, "Invalid or missing message.");
  }
}

function optionalHistory(history) {
  if (history === undefined) return;

  if (!Array.isArray(history)) {
    throw new HttpError(400, "Invalid history. Expected an array.");
  }

  const isValidTurn = (turn) =>
    turn &&
    (turn.role === "user" || turn.role === "assistant") &&
    typeof turn.content === "string";

  if (!history.every(isValidTurn)) {
    throw new HttpError(
      400,
      'Invalid history entry. Expected { role: "user" | "assistant", content: string }.'
    );
  }
}

function requireText(text) {
  if (!text || typeof text !== "string" || text.trim() === "") {
    throw new HttpError(400, "Invalid or missing text.");
  }
}

function requireAudioBuffer(body) {
  if (!body || body.length === 0) {
    throw new HttpError(400, "Missing audio body.");
  }
}

module.exports = {
  HttpError,
  requireSubtitles,
  optionalSubtitles,
  requireMessage,
  optionalHistory,
  requireText,
  requireAudioBuffer,
};
