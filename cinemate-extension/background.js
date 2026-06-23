chrome.runtime.onInstalled.addListener(() => {
  console.log("Cinemate installed successfully");
});

// Listen for message from content script to open the discussion panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openDiscussionPanel') {
    chrome.windows.create({
      url: chrome.runtime.getURL('discussion-panel.html'),
      type: 'popup',
      width: 400,
      height: 650
    });
  }
});
