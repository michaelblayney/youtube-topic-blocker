# YouTube Content Filter (Chrome Extension)

<p align="left">
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-1f6feb?style=for-the-badge">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Chrome-Manifest%20V3-0ea5e9?style=for-the-badge&logo=googlechrome&logoColor=white">
  <img alt="Model" src="https://img.shields.io/badge/model-gpt--4o--mini-16a34a?style=for-the-badge">
  <img alt="Status" src="https://img.shields.io/badge/status-active-22c55e?style=for-the-badge">
</p>

YouTube video card filtering for topic-based content blocking.

> [!IMPORTANT]
> Video metadata stays hidden until classification completes.

## At a Glance

| Area | Status |
|---|---|
| Topic Blocking | `Enabled` |
| Safe-Only Reveal | `Enabled` |
| Home Feed | `Supported` |
| Watch Recommendations | `Supported` |
| Backend Required | `No` |

## Highlights

- :brain: Topic-based blocking with comma-separated rules (for example: `crypto, gambling, gossip`).
- :lock: Privacy-first presentation: titles and media remain hidden while checks are pending.
- :white_check_mark: Visual verification for approved videos (checked marker on safe titles).
- :dart: Coverage for YouTube Home and Watch-page recommendation surfaces.
- :bar_chart: Usage telemetry in Options (titles processed, LLM calls, token estimates, estimated spend).

## Product Behavior

| Classification | Result |
|---|---|
| `safe` | Video stays visible and title is restored |
| `blocked` | Video card is removed from view |
| `unknown` | Video remains in pending/hidden state until retried |

This guarantees videos are not shown before they have been checked.

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

- :lock: API key is stored in Chrome extension storage on your local profile.
- :outbox_tray: Title text is sent to OpenAI for classification.
- :building_construction: No external backend is required for core operation.

<details>
<summary><strong>Quick Usage Tip</strong></summary>

Use focused blocked topic lists (3-10 terms) for best precision and cleaner results.

</details>

