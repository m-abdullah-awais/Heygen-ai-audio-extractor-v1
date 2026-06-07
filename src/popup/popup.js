/**
 * HeyGen Audio URL Extractor
 * Author : Muhammad Abdullah Awais, Full Stack Developer
 * Website: https://www.abdullahawais.com
 * -----------------------------------------------------------------------------
 * popup.js: popup controller (ES module).
 *
 * Responsibilities:
 *  - Enforce the website restriction at the popup level.
 *  - Ask the content script to scan the page when "Fetch Audio" is clicked.
 *  - Render results in a table with per-row Open + Copy actions, plus "Copy All".
 *  - Handle messaging / permission / page-access errors gracefully.
 */

import { PARENT_WEBSITE_URL, AUDIO_URL_PREFIX } from "../config/config.js";

// Resolve the content script path once (relative to the extension root).
const CONTENT_SCRIPT_PATH = "src/content/content.js";

// Inline SVG icons for the per-row action buttons (trusted, static markup).
const ICON_OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
const ICON_COPY =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

// ---- DOM references ----
const bannerEl = document.getElementById("banner");
const fetchBtn = document.getElementById("fetchBtn");
const copyAllBtn = document.getElementById("copyAllBtn");
const resultsEl = document.getElementById("results"); // <tbody>

// Holds the most recent extraction so "Copy All" has data to work with.
let currentUrls = [];

/**
 * Show a status banner in one of three styles.
 * @param {string} message
 * @param {"info"|"success"|"error"} [type]
 */
function showBanner(message, type = "info") {
  bannerEl.textContent = message;
  bannerEl.className = `banner banner--${type} is-visible`;
}

function hideBanner() {
  bannerEl.className = "banner banner--info";
  bannerEl.textContent = "";
}

/**
 * Toggle the Fetch button between idle and busy states without losing its icon.
 * @param {boolean} busy
 */
function setFetchBusy(busy) {
  fetchBtn.disabled = busy;
  fetchBtn.innerHTML = busy
    ? '<span class="btn__icon" aria-hidden="true">&#x231b;</span> Scanning…'
    : '<span class="btn__icon" aria-hidden="true">&#x21bb;</span> Fetch Audio';
}

/**
 * Render a single full-width state row (idle / empty / error) inside the table.
 * @param {string} title
 * @param {string} sub
 */
function renderState(title, sub) {
  resultsEl.replaceChildren();
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.className = "state-cell";
  td.colSpan = 3;
  const t = document.createElement("span");
  t.className = "state-title";
  t.textContent = title;
  const s = document.createElement("span");
  s.className = "state-sub";
  s.textContent = sub;
  td.append(t, s);
  tr.appendChild(td);
  resultsEl.appendChild(tr);
}

/**
 * Promise wrapper around chrome.tabs.query for the active tab.
 * @returns {Promise<chrome.tabs.Tab|undefined>}
 */
function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
}

/**
 * Send the scan message to a tab. Resolves with the content script's response
 * or rejects with an Error if the channel failed (e.g. script not present).
 * @param {number} tabId
 * @returns {Promise<{ok: boolean, urls?: string[], error?: string}>}
 */
function sendScanMessage(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "SCAN_AUDIO", prefix: AUDIO_URL_PREFIX }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Inject the content script on demand. Used as a fallback when the page was
 * already open before the extension was installed/updated, so the declared
 * content script never ran.
 * @param {number} tabId
 * @returns {Promise<void>}
 */
function injectContentScript(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_PATH],
  });
}

/**
 * Copy text to the clipboard, returning whether it succeeded.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build one table row for a single URL.
 * @param {string} url
 * @param {number} index 1-based position (order matters for the voiceover)
 * @returns {HTMLTableRowElement}
 */
function buildRow(url, index) {
  const tr = document.createElement("tr");

  // Column 1: order badge.
  const idxTd = document.createElement("td");
  idxTd.className = "col-idx";
  const badge = document.createElement("span");
  badge.className = "idx-badge";
  badge.textContent = String(index);
  idxTd.appendChild(badge);

  // Column 2: clickable, truncated URL (monospace).
  const urlTd = document.createElement("td");
  urlTd.className = "url-cell";
  const link = document.createElement("a");
  link.className = "url-link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.title = url; // full URL on hover
  link.textContent = url;
  urlTd.appendChild(link);

  // Column 3: Open + Copy icon actions.
  const actionsTd = document.createElement("td");
  actionsTd.className = "col-actions";
  const actions = document.createElement("div");
  actions.className = "actions";

  const openBtn = document.createElement("button");
  openBtn.className = "icon-btn";
  openBtn.type = "button";
  openBtn.title = "Open in a new tab";
  openBtn.setAttribute("aria-label", "Open in a new tab");
  openBtn.innerHTML = ICON_OPEN;
  openBtn.addEventListener("click", () => chrome.tabs.create({ url }));

  const copyBtn = document.createElement("button");
  copyBtn.className = "icon-btn";
  copyBtn.type = "button";
  copyBtn.title = "Copy URL";
  copyBtn.setAttribute("aria-label", "Copy URL");
  copyBtn.innerHTML = ICON_COPY;
  copyBtn.addEventListener("click", async () => {
    const ok = await copyToClipboard(url);
    if (ok) {
      copyBtn.innerHTML = ICON_CHECK;
      copyBtn.classList.add("is-copied");
      setTimeout(() => {
        copyBtn.innerHTML = ICON_COPY;
        copyBtn.classList.remove("is-copied");
      }, 1200);
    }
  });

  actions.append(openBtn, copyBtn);
  actionsTd.appendChild(actions);

  tr.append(idxTd, urlTd, actionsTd);
  return tr;
}

/**
 * Render the extracted URLs into the results table.
 * @param {string[]} urls
 */
function renderResults(urls) {
  if (urls.length === 0) {
    renderState("No audio URLs found", "Make sure the voice has finished generating, then try again.");
    copyAllBtn.hidden = true;
    return;
  }

  resultsEl.replaceChildren();
  urls.forEach((url, i) => resultsEl.appendChild(buildRow(url, i + 1)));
  copyAllBtn.hidden = false;
}

/**
 * Main fetch handler: scan the active tab and render the results.
 */
async function handleFetch() {
  setFetchBusy(true);
  hideBanner();

  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      throw new Error("Could not access the active tab.");
    }

    let response;
    try {
      response = await sendScanMessage(tab.id);
    } catch {
      // Fallback: content script not loaded yet; inject it, then retry once.
      await injectContentScript(tab.id);
      response = await sendScanMessage(tab.id);
    }

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Scan failed.");
    }

    currentUrls = response.urls || [];
    renderResults(currentUrls);

    if (currentUrls.length > 0) {
      showBanner(`Found ${currentUrls.length} audio URL${currentUrls.length === 1 ? "" : "s"}.`, "success");
    } else {
      hideBanner();
    }
  } catch (error) {
    currentUrls = [];
    copyAllBtn.hidden = true;
    renderState("Couldn't scan this page", "Open an app.heygen.com page, reload it, then try again.");
    showBanner("Couldn't scan this page. Make sure you're on an app.heygen.com page and try reloading it.", "error");
    console.error("[HeyGen Audio Extractor]", error);
  } finally {
    setFetchBusy(false);
  }
}

/**
 * Copy every extracted URL (newline separated, in display order).
 */
async function handleCopyAll() {
  if (currentUrls.length === 0) return;
  const ok = await copyToClipboard(currentUrls.join("\n"));
  copyAllBtn.textContent = ok ? "Copied!" : "Failed";
  setTimeout(() => {
    copyAllBtn.textContent = "Copy All";
  }, 1200);
}

/**
 * On popup open: enforce the website restriction and show an idle state.
 */
async function init() {
  fetchBtn.addEventListener("click", handleFetch);
  copyAllBtn.addEventListener("click", handleCopyAll);

  const tab = await getActiveTab();
  const url = tab && tab.url ? tab.url : "";

  if (!url.startsWith(PARENT_WEBSITE_URL)) {
    fetchBtn.disabled = true;
    renderState("Website not supported", `Open ${PARENT_WEBSITE_URL} to use this extension.`);
    showBanner(`This website is not supported. Open ${PARENT_WEBSITE_URL} to use this extension.`, "info");
    return;
  }

  renderState("Ready to scan", 'Click "Fetch Audio" to collect every audio URL on this page.');
}

init();
