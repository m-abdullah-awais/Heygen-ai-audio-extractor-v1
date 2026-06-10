/**
 * HeyGen Audio Extractor
 * Author : Muhammad Abdullah Awais, Full Stack Developer
 * Website: https://www.abdullahawais.com
 * -----------------------------------------------------------------------------
 * content.js: DOM scanner injected on HeyGen pages.
 *
 * It listens for a { type: "SCAN", prefix } message from the popup and replies
 * with { urls: [...] }: every UNIQUE URL on the page that starts with the given
 * prefix. The same routine is used for both audio and video; only the prefix
 * the popup passes in differs.
 *
 * The detection / scanning / matching logic here is UNCHANGED; it still finds
 * exactly the same URLs as before. The popup converts these internal URLs into
 * audio / video items; the URLs themselves are never shown to the user.
 *
 * ORDERING: the list is returned in the order the URLs are discovered on the
 * page (the de-duplicating Set preserves first-seen order, and the result is
 * intentionally NOT sorted). The popup numbers them Audio 1, Audio 2, ... in
 * this exact order, which users rely on when combining the chunks.
 *
 * HeyGen is a React SPA, so audio URLs are frequently NOT plain <audio> tags;
 * they hide inside inline JSON, data-* attributes, and script payloads. We
 * therefore build a broad search corpus from many sources rather than only
 * inspecting media elements.
 */

/**
 * Escape a string so it can be safely embedded inside a RegExp.
 * @param {string} str
 * @returns {string}
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip characters that commonly cling to the tail of a URL when it was
 * embedded in markup or JSON (quotes, commas, closing brackets, etc.).
 * @param {string} url
 * @returns {string}
 */
function cleanUrl(url) {
  return url.replace(/[\s"'`,;)\]}<>\\]+$/g, "");
}

/**
 * Collect text from every place a URL might be hiding on the page.
 * Returns a single large string that the regex is run against, plus a few
 * targeted values that may already be fully resolved (e.g. media currentSrc).
 * @returns {string[]} array of text chunks to scan
 */
function buildSearchCorpus() {
  const chunks = [];

  // 1. The full serialized DOM (catches anything rendered into markup).
  chunks.push(document.documentElement.outerHTML);

  // 2. Every attribute of every element. This covers src, href, style,
  //    poster, and all data-* attributes in one sweep.
  for (const el of document.querySelectorAll("*")) {
    for (const attr of el.attributes) {
      if (attr.value) chunks.push(attr.value);
    }
  }

  // 3. Targeted pulls from media + anchors. currentSrc resolves the element's
  //    *active* source even when set via the resource selection algorithm.
  for (const media of document.querySelectorAll("audio, video, source")) {
    if (media.src) chunks.push(media.src);
    if (media.currentSrc) chunks.push(media.currentSrc);
  }
  for (const a of document.querySelectorAll("a[href]")) {
    chunks.push(a.href);
  }

  // 4. Inline <script> contents: React/Next.js hydration data and config
  //    blobs commonly embed media URLs as JSON strings here.
  for (const script of document.querySelectorAll("script")) {
    if (script.textContent) chunks.push(script.textContent);
  }

  return chunks;
}

/**
 * Extract all unique URLs beginning with `prefix` from the live page.
 * Query strings are kept (the matcher only stops at quotes/whitespace/brackets),
 * so signed video URLs keep their `?...` parameters intact.
 * @param {string} prefix
 * @returns {string[]} de-duplicated URLs, in the order they are discovered
 */
function extractUrlsByPrefix(prefix) {
  // Match the prefix followed by any run of "URL-ish" characters, stopping at
  // the first delimiter/quote/closing bracket.
  const pattern = new RegExp(escapeRegExp(prefix) + "[^\\s\"'`<>\\\\)\\]}]+", "g");

  const found = new Set();

  for (let chunk of buildSearchCorpus()) {
    if (!chunk) continue;

    // Normalize escaped slashes so URLs embedded in JSON ("https:\/\/...")
    // are matched the same as plain ones.
    const normalized = chunk.replace(/\\\//g, "/").replace(/\\u002F/gi, "/");

    const matches = normalized.match(pattern);
    if (!matches) continue;

    for (const raw of matches) {
      const url = cleanUrl(raw);
      if (url.startsWith(prefix)) found.add(url);
    }
  }

  // Preserve discovery order (first-seen). Do NOT sort: the popup numbers the
  // items Audio 1, Audio 2, ... in this order and users combine them likewise.
  return Array.from(found);
}

/**
 * Message handler. Responds asynchronously, so we return `true` to keep the
 * message channel open until sendResponse is called.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "SCAN") {
    return; // Not for us; ignore unknown messages gracefully.
  }

  try {
    const urls = extractUrlsByPrefix(message.prefix);
    sendResponse({ ok: true, urls });
  } catch (error) {
    sendResponse({ ok: false, error: String(error && error.message ? error.message : error) });
  }

  return true;
});
