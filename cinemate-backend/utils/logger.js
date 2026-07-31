const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "data", "logs");
const LOG_FILE = path.join(LOG_DIR, "app.log");

function write(level, message, meta) {
  fs.mkdirSync(LOG_DIR, { recursive: true });

  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  });

  fs.appendFile(LOG_FILE, `${line}\n`, () => {});

  const consoleFn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  consoleFn(`[${level.toUpperCase()}] ${message}`);
}

module.exports = {
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
};
