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

const MAX_MESSAGE_CHARS = 1000;

function requireMessage(message) {
  if (!message || typeof message !== "string" || message.trim() === "") {
    throw new HttpError(400, "Invalid or missing message.");
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    throw new HttpError(400, `Message is too long (max ${MAX_MESSAGE_CHARS} characters).`);
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

// Optional fields from the extension. null is treated the same as "not sent".
function optionalNumber(value, name) {
  if (value === undefined || value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new HttpError(400, `Invalid ${name}. Expected a number of seconds.`);
  }
}

function optionalString(value, name, maxLength = 300) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new HttpError(400, `Invalid ${name}. Expected text up to ${maxLength} characters.`);
  }
}

function optionalBoolean(value, name) {
  if (value === undefined || value === null) return;
  if (typeof value !== "boolean") {
    throw new HttpError(400, `Invalid ${name}. Expected true or false.`);
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
  optionalNumber,
  optionalString,
  optionalBoolean,
};