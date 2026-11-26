// utils/api.js
// Talks to the CineMate backend. Every failure becomes an ApiError with a
// message the panel can show as-is (plus retryAfterSeconds for rate limits).

(function (root) {
  const CineMate = (root.CineMate = root.CineMate || {});

  const API_BASE = "http://localhost:3000";

  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.retryAfterSeconds = data.retryAfterSeconds;
      this.code = data.code;
    }
  }

  async function request(method, path, body) {
    let response;

    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError("Can't reach the CineMate server – is it running on localhost:3000?", 0);
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      throw new ApiError(data.error || `Request failed (${response.status}).`, response.status, data);
    }

    return data;
  }

  const memoryPath = (episodeId) => `/memory/${encodeURIComponent(episodeId)}`;

  // The saved memory record for a video, or null if there isn't one yet.
  async function getMemory(episodeId) {
    try {
      return await request("GET", memoryPath(episodeId));
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  CineMate.api = {
    API_BASE,
    ApiError,
    post: (path, body) => request("POST", path, body),
    get: (path) => request("GET", path),
    getMemory,
    listMemories: async () => (await request("GET", "/memory")).episodes || [],
    deleteMemory: (episodeId) => request("DELETE", memoryPath(episodeId)),
  };
})(globalThis);