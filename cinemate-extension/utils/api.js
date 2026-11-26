// utils/api.js
// Talks to the CineMate backend. Every failure becomes an ApiError with a
// message the panel can show as-is (plus retryAfterSeconds for rate limits).

(function (root) {
  const CineMate = (root.CineMate = root.CineMate || {});

  // Set from the settings page (cinemateSettings.backendUrl) via setBase().
  let apiBase = "http://localhost:3000";

  function setBase(url) {
    if (url) apiBase = String(url).replace(/\/+$/, "");
  }

  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.retryAfterSeconds = data.retryAfterSeconds;
      this.code = data.code;
    }
  }

  // options.signal: an AbortSignal, so the Stop button can cancel a request.
  async function request(method, path, body, options = {}) {
    let response;

    try {
      response = await fetch(`${apiBase}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: options.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error; // stopped on purpose
      throw new ApiError(`Can't reach the CineMate server at ${apiBase} – is it running?`, 0);
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
    get API_BASE() {
      return apiBase;
    },
    setBase,
    ApiError,
    post: (path, body, options) => request("POST", path, body, options),
    get: (path) => request("GET", path),
    getMemory,
    listMemories: async () => (await request("GET", "/memory")).episodes || [],
    deleteMemory: (episodeId) => request("DELETE", memoryPath(episodeId)),
    health: () => request("GET", "/health"),
    voiceStatus: () => request("GET", "/voice/status?refresh=1"),
  };
})(globalThis);