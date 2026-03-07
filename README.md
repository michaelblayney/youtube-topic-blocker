# YouTube Content Filter (Chrome Extension)

<p align="left" style="margin:0;">
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-1f6feb?style=for-the-badge">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Chrome-Manifest%20V3-0ea5e9?style=for-the-badge&logo=googlechrome&logoColor=white">
  <img alt="Model" src="https://img.shields.io/badge/model-gpt--4o--mini-16a34a?style=for-the-badge">
</p>

YouTube video card filtering for topic-based content blocking.

<p align="left" style="margin:0;">
  &emsp;<img src="assets/extension_example.gif" alt="Extension Demo" width="280" /><br />
  &emsp;<sub>Checks video before displaying. Shows video only if it's not related to any blacklisted topics. </sub>
</p>

## Highlights

- Topic-based blocking with comma-separated rules (for example: `crypto, gambling, gossip`).
- Titles and media remain hidden while checks are pending.
- Visual verification for approved videos.
- Coverage for YouTube Home and Watch-page recommendation surfaces.
- Usage telemetry in Options (titles processed, LLM calls, token estimates, estimated spend).

## Installation & Configuration

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.
5. Open extension **Details** -> **Extension options**.
6. Enter your OpenAI API key.
7. Set blocked topics as a comma-separated list.
8. Save settings.

> [!NOTE]
> Model selection is currently fixed to `gpt-4o-mini` in the UI.

## Security and Data Handling

- API key is stored in Chrome extension storage on your local profile.
- Title text is sent to OpenAI for classification.
- No external backend is required for core operation.











