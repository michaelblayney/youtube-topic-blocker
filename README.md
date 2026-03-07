# YouTube Content Filter

YouTube video card filtering for topic-based content blocking.

This extension hides video metadata until each title is classified, then reveals only content marked safe.

## Highlights

- Topic-based blocking with comma-separated rules (for example: `crypto, gambling, gossip`).
- Privacy-first presentation flow: titles and media stay hidden while checks are pending.
- Strict safety posture: uncertain classifications remain hidden (never auto-revealed).
- Visual verification for approved videos (checked marker on safe titles).
- Coverage for YouTube Home feed and Watch-page recommendation surfaces.
- Usage telemetry in Options (titles processed, LLM calls, token estimates, estimated spend).

## Product Behavior

- `safe`: video stays visible and title is restored.
- `blocked`: video card is removed from view.
- `unknown`: video remains in pending/hidden state until retried.

This ensures videos are not shown before classification completes.

## Architecture

- `src/content.js`: DOM detection, pending masking, and per-title status application.
- `src/background.js`: classification orchestration, OpenAI calls, throttling, cache, and runtime locks.
- `src/options.html|css|js`: configuration and usage dashboard.
- `src/popup.html|css|js`: compact runtime snapshot and quick actions.

## Installation

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.
5. Open extension **Details** -> **Extension options**.

## Configuration

In the Options page:

1. Enter your OpenAI API key.
2. Set blocked topics as a comma-separated list.
3. Save settings.

Model is currently fixed to `gpt-4o-mini` in the UI.

## Runtime and Rate Limits

The extension applies cooldown locks for quota and rate-limit responses from the provider.

- Quota cooldown: long disable window when the API reports quota exhaustion.
- Rate-limit cooldown: short backoff window when request rate is exceeded.

Status appears in both popup and options when active.

## Security and Data Handling

- API key is stored in Chrome extension storage on your local profile.
- Title text is sent to OpenAI for classification.
- No external backend is required for core operation.

## Local Development

- Reload the extension from `chrome://extensions` after code changes.
- Use the extension service worker and page consoles for debugging.
- If you change permissions or manifest fields, reload the unpacked extension.

## Repository Structure

```text
.
|-- manifest.json
|-- src/
|   |-- background.js
|   |-- content.js
|   |-- options.css
|   |-- options.html
|   |-- options.js
|   |-- popup.css
|   |-- popup.html
|   |-- popup.js
|-- assets/icons/
```

## Known Scope

- YouTube title-based filtering only (not transcript or comments).
- Requires valid OpenAI credentials to classify new uncached titles.

## License

Private/internal project unless a separate license file is added.
