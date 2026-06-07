# HeyGen Audio URL Extractor

A Manifest V3 Chrome extension that activates **only** on `https://app.heygen.com` and extracts every
audio URL on the current page that begins with `https://resource2.heygen.ai`.

> Built by **Muhammad Abdullah Awais** — Full Stack Developer · [www.abdullahawais.com](https://www.abdullahawais.com)

## Features

- **Website-restricted** — runs only on the configured parent site (manifest-level + popup-level checks).
- **Thorough DOM scan** — inspects the serialized HTML, every element attribute (incl. `data-*`),
  `<audio>`/`<video>`/`<source>` tags, anchors, and inline `<script>` JSON, so it catches URLs that are
  not visible on the page.
- **De-duplicated, scrollable results** — each URL has a clickable link and a **Copy** button, plus a
  **Copy All** button.
- **Graceful errors** — friendly messages for unsupported sites, no results, and page-access failures.

## Install (development)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the `heygen-audio-extractor/` folder.
4. Pin the extension and open `https://app.heygen.com`, then click **Fetch Audio**.

## Configuration

Both configurable values live in [`src/config/config.js`](src/config/config.js):

```js
export const PARENT_WEBSITE_URL = "https://app.heygen.com";
export const AUDIO_URL_PREFIX  = "https://resource2.heygen.ai";
```

> **Note:** if you change `PARENT_WEBSITE_URL`, also update the matching patterns in
> [`manifest.json`](manifest.json) (`content_scripts.matches` and `host_permissions`) — the manifest
> cannot import JavaScript.

## Project structure

```
heygen-audio-extractor/
├── manifest.json              # MV3 config + website restriction
├── src/
│   ├── config/config.js       # PARENT_WEBSITE_URL + AUDIO_URL_PREFIX
│   ├── popup/                  # popup.html / popup.css / popup.js
│   ├── content/content.js     # DOM scanner (message-driven)
│   └── background/background.js# minimal service worker
└── icons/                     # 16 / 48 / 128 px icons
```

## How it works

1. The popup verifies the active tab is under `PARENT_WEBSITE_URL`; otherwise it shows a
   "not supported" message and disables the button.
2. Clicking **Fetch Audio** sends a `SCAN_AUDIO` message (with the prefix) to the content script.
   If the content script isn't loaded yet (page opened before install), the popup injects it via
   `chrome.scripting` and retries.
3. The content script builds a broad text corpus from the page, normalizes JSON-escaped slashes,
   regex-matches the prefix, de-duplicates with a `Set`, and returns a sorted list.

## Limitation

Scanning is **DOM-only**. URLs that the page fetches purely via XHR/`fetch` and never writes into the
DOM won't be captured. If that happens on HeyGen, add a `chrome.webRequest` listener in
`background.js` to passively record matching requests (the natural upgrade path).

## Author

**Muhammad Abdullah Awais**
Full Stack Developer
🌐 [www.abdullahawais.com](https://www.abdullahawais.com)

## License

© Muhammad Abdullah Awais. All rights reserved.
