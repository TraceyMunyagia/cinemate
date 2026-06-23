console.log("🎬 CineMate content script running");

// PLATFORM DETECTION
const isNetflix = window.location.hostname.includes("netflix.com");
const isYouTube = window.location.hostname.includes("youtube.com");

if (isNetflix || isYouTube) {
  console.log("✅ CineMate active on supported platform");

  // Prevent duplicate injection
  if (!document.getElementById('cinemate-floating-btn')) {
    const btn = document.createElement('button');
    btn.id = 'cinemate-floating-btn';
    btn.innerText = '🎬';
    btn.style.position = 'fixed';
    btn.style.bottom = '32px';
    btn.style.right = '32px';
    btn.style.width = '64px';
    btn.style.height = '64px';
    btn.style.borderRadius = '50%';
    btn.style.background = '#7C3AED';
    btn.style.color = 'white';
    btn.style.fontSize = '32px';
    btn.style.border = 'none';
    btn.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
    btn.style.zIndex = '999999';
    btn.style.cursor = 'pointer';
    btn.title = 'Open CineMate Panel';

    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openDiscussionPanel' });
    });

    document.body.appendChild(btn);
  }
}

// STORE LAST SUBTITLE TO AVOID DUPLICATES
let lastSubtitle = "";

// TIMESTAMP HELPER
function getTimestamp() {
  const video = document.querySelector("video");

  if (!video) return "00:00:00";

  const seconds = Math.floor(video.currentTime);

  const hrs = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const mins = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");

  return `${hrs}:${mins}:${secs}`;
}

// GET SUBTITLES
function getSubtitles() {
  let subtitleText = "";

  // YOUTUBE
  if (isYouTube) {
    const subtitles = document.querySelectorAll(".ytp-caption-segment");

    subtitleText = Array.from(subtitles)
      .map(el => el.textContent.trim())
      .join(" ");
  }

  // NETFLIX
  if (isNetflix) {
    const subtitles = document.querySelectorAll(
      ".player-timedtext-text-container span"
    );

    subtitleText = Array.from(subtitles)
      .map(el => el.innerText.trim())
      .join(" ");
  }

  return subtitleText.trim();
}

// CAPTURE LOOP
function captureSubtitles() {
  const text = getSubtitles();

  // IGNORE EMPTY OR DUPLICATE SUBTITLES
  if (!text || text === lastSubtitle) return;

  lastSubtitle = text;

  const entry = {
    time: getTimestamp(),
    text
  };

  console.log("📝 Subtitle captured:", entry);

  // SAVE TO LOCAL STORAGE
  chrome.storage.local.get(["subtitles"], (result) => {
    const subtitles = result.subtitles || [];

    subtitles.push(entry);

    chrome.storage.local.set({ subtitles });
  });
}

// RUN EVERY SECOND
setInterval(captureSubtitles, 1000);

// DEBUG ACCESS
window.CineMate = {
  getSubtitles
};