# YouTube Content Filter (Chrome Extension)

Checks YouTube titles with an LLM and hides videos that match blocked topics.

## Features
- Block by topic keywords (example: crypto, video-games, sports, gossip).
- Titles and thumbnails are hidden with `Checking Video...` until LLM classification completes.
- Safe titles show with a `*` marker so you can confirm they were checked.
- Blocked videos are fully hidden.
- Works on:
  - Homepage feed
  - Watch page related videos (right rail + mobile-like containers)

## Setup
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and pick this folder.
4. Open extension **Details** -> **Extension options**.
5. Set:
   - API key
   - Model (default: `gpt-4o-mini`)
   - Blocked topics (comma-separated)

## Notes
- API key is stored in Chrome local extension storage on your machine.
- The extension calls OpenAI directly from the background worker.
- To use a different provider, update `src/background.js` request URL and payload.