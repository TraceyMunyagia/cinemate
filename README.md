# CineMate AI

An AI Chrome extension that watches along with you on YouTube and Netflix. It reads the captions as you watch, so you can ask questions about scenes, characters and plot by voice or with quick actions, and get spoken answers.

## Project structure

```
cinemate-extension/   Chrome extension (Manifest V3)
cinemate-backend/     Express API: chat, summaries, episode memory, voice
```

## Backend setup

```bash
cd cinemate-backend
npm install
cp .env.example .env    # add GEMINI_API_KEY (or ANTHROPIC_API_KEY)
npm start               # http://localhost:3000
```

Set `USE_MOCK_AI=true` in `.env` to test without spending API credits.

Optional local voice (Whisper speech-to-text + pyttsx3 text-to-speech) needs Python 3 and ffmpeg:

```bash
pip install -r requirements-local-voice.txt
```

Without it, replies fall back to the browser's built-in voice.

## Extension setup

1. Open `chrome://extensions` and turn on **Developer mode**
2. Click **Load unpacked** and select `cinemate-extension/`
3. Open a YouTube or Netflix video and **turn on captions (CC)**
4. Click the 🎬 button (or the toolbar icon) to open the panel

## How captions are captured

- Each video gets its own session (`youtube-<id>` / `netflix-<id>`), stored under `subtitles:<videoId>` in `chrome.storage.local`
- Switching videos, including YouTube's in-page navigation and Netflix's next episode, starts a new session. Going back to a video resumes its session.
- Rolling YouTube captions are merged into clean lines, without duplicates
- The 15 most recent videos are kept, with up to 5,000 lines each
- 🧹 in the panel clears the current video's captions

## Tests

```bash
cd cinemate-extension
node tests/replay-captions.js
node tests/storage-and-video.js
```