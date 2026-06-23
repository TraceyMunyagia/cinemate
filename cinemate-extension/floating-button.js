document.getElementById("openPanelBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "openDiscussionPanel" });
  window.close();
});
