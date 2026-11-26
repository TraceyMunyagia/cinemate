const config = require("../config");
const { version } = require("../package.json");

// GET /health – lets the panel and the settings page check the server is up.
// Never includes API keys, only whether one is set.
function health(req, res) {
  const provider = config.aiProvider;

  res.json({
    success: true,
    service: "cinemate-backend",
    version,
    ai: {
      provider,
      model: config[provider].model,
      mock: config.useMockAi,
      keySet: Boolean(config[provider].apiKey),
    },
  });
}

module.exports = { health };