const logger = require("../utils/logger");

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const isRateLimit = /429|RetryInfo/.test(err.message || "");
  const status = err.status || (isRateLimit ? 429 : 500);
  const message = status === 429
    ? "Rate limit hit. Please wait a moment and try again."
    : (err.message || "Unexpected server error.");

  logger.error(`${req.method} ${req.originalUrl} failed: ${err.message}`, { stack: err.stack });

  res.status(status).json({ success: false, error: message });
}

module.exports = errorHandler;
