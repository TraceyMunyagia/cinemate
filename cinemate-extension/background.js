// background.js (service worker)
// Opens the discussion panel, reusing the window if it's already open.

const PANEL_URL = chrome.runtime.getURL("discussion-panel.html");
const PANEL_WINDOW_KEY = "cinematePanelWindowId";

let opening = null; // stops a double-click from opening two windows

chrome.runtime.onInstalled.addListener(() => {
  console.log("CineMate installed successfully");
});

function openPanel() {
  if (!opening) {
    opening = doOpenPanel().finally(() => {
      opening = null;
    });
  }
  return opening;
}

async function doOpenPanel() {
  // storage.session survives the service worker going to sleep.
  const stored = await chrome.storage.session.get(PANEL_WINDOW_KEY);
  const windowId = stored[PANEL_WINDOW_KEY];

  if (windowId) {
    try {
      await chrome.windows.update(windowId, { focused: true, drawAttention: true });
      return;
    } catch {
      // The window was closed – fall through and open a new one.
    }
  }

  const panel = await chrome.windows.create({
    url: PANEL_URL,
    type: "popup",
    width: 400,
    height: 680,
  });

  await chrome.storage.session.set({ [PANEL_WINDOW_KEY]: panel.id });
}

chrome.windows.onRemoved.addListener(async (windowId) => {
  const stored = await chrome.storage.session.get(PANEL_WINDOW_KEY);
  if (stored[PANEL_WINDOW_KEY] === windowId) {
    await chrome.storage.session.remove(PANEL_WINDOW_KEY);
  }
});

// The 🎬 button on YouTube / Netflix.
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "openDiscussionPanel") {
    openPanel();
  }
});

// The toolbar icon. Tell the tab to make its video active, then open the panel.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.tabs.sendMessage(tab.id, { action: "activateSession" });
  } catch {
    // Not a YouTube/Netflix tab – the panel will say no video is detected.
  }
  openPanel();
});