const memoryService = require("../services/memoryService");

// GET /memory/:episodeId
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

// GET /memory
async function listMemories(req, res, next) {
  try {
    const episodes = await memoryService.listEpisodeMemories();
    res.json({ success: true, episodes });
  } catch (error) {
    next(error);
  }
}

// DELETE /memory/:episodeId  (the panel's "Forget" button)
async function deleteMemory(req, res, next) {
  try {
    const deleted = await memoryService.deleteEpisodeMemory(req.params.episodeId);
    res.json({ success: true, deleted });
  } catch (error) {
    next(error);
  }
}

module.exports = { getMemory, listMemories, deleteMemory };