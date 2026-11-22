const logger = require("../utils/logger");

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  const message = err.message || "Unexpected server error.";

  logger.error(`${req.method} ${req.originalUrl} failed: ${message}`, { stack: err.stack });

  if (err.retryAfterSeconds) {
    res.setHeader("Retry-After", String(err.retryAfterSeconds));
  }

  res.status(status).json({
    success: false,
    error: message,
    ...(err.code ? { code: err.code } : {}),
    ...(err.retryAfterSeconds ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
  });
}

module.exports = errorHandler;