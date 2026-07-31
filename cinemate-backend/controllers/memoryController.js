const memoryService = require("../services/memoryService");

async function getMemory(req, res, next) {
  try {
    const record = await memoryService.getEpisodeMemory(req.params.episodeId);

    if (!record) {
      return res.status(404).json({
        success: false,
        error: "No saved memory for this episode.",
      });
    }

    res.json({ success: true, ...record });
  } catch (error) {
    next(error);
  }
}

async function listMemories(req, res, next) {
  try {
    const episodes = await memoryService.listEpisodeMemories();
    res.json({ success: true, episodes });
  } catch (error) {
    next(error);
  }
}

module.exports = { getMemory, listMemories };
