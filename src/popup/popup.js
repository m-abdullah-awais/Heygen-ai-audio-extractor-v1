/**
 * HeyGen Audio URL Extractor
 * Author : Muhammad Abdullah Awais — Full Stack Developer
 * Website: https://www.abdullahawais.com
 * -----------------------------------------------------------------------------
 * popup.js — popup controller (ES module).
 *
 * Responsibilities:
 *  - Enforce the website restriction at the popup level.
 *  - Ask the content script to scan the page when "Fetch Audio" is clicked.
 *  - Render results with per-row copy + a "Copy All" action.
 *  - Handle messaging / permission / page-access errors gracefully.
 */

import { PARENT_WEBSITE_URL, AUDIO_URL_PREFIX } from "../config/config.js";

// Resolve the content script path once (relative to the extension root).
const CONTENT_SCRIPT_PATH = "src/content/content.js";

// ---- DOM references ----
const bannerEl = document.getElementById("banner");
const fetchBtn = document.getElementById("fetchBtn");
const copyAllBtn = document.getElementById("copyAllBtn");
const resultsEl = document.getElementById("results");

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
 * Render the extracted URLs into the scrollable list.
 * @param {string[]} urls
 */
function renderResults(urls) {
  resultsEl.replaceChildren();

  if (urls.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No matching audio URLs found on this page.";
    resultsEl.appendChild(empty);
    copyAllBtn.hidden = true;
    return;
  }

  for (const url of urls) {
    const row = document.createElement("li");
    row.className = "result-row";

    const link = document.createElement("a");
    link.className = "result-link";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = url; // full URL on hover; the row truncates with an ellipsis
    link.textContent = url;

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      const ok = await copyToClipboard(url);
      copyBtn.textContent = ok ? "Copied!" : "Failed";
      copyBtn.classList.toggle("is-copied", ok);
      setTimeout(() => {
        copyBtn.textContent = "Copy";
        copyBtn.classList.remove("is-copied");
      }, 1200);
    });

    row.append(link, copyBtn);
    resultsEl.appendChild(row);
  }

  copyAllBtn.hidden = false;
}

/**
 * Main fetch handler: scan the active tab and render the results.
 */
async function handleFetch() {
  fetchBtn.disabled = true;
  fetchBtn.textContent = "Scanning…";
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
      // Fallback: content script not loaded yet — inject it, then retry once.
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
    resultsEl.replaceChildren();
    copyAllBtn.hidden = true;
    showBanner(
      "Couldn't scan this page. Make sure you're on an app.heygen.com page and try reloading it.",
      "error"
    );
    console.error("[HeyGen Audio Extractor]", error);
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = "Fetch Audio";
  }
}

/**
 * Copy every extracted URL (newline separated).
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
 * On popup open: enforce the website restriction.
 */
async function init() {
  fetchBtn.addEventListener("click", handleFetch);
  copyAllBtn.addEventListener("click", handleCopyAll);

  const tab = await getActiveTab();
  const url = tab && tab.url ? tab.url : "";

  if (!url.startsWith(PARENT_WEBSITE_URL)) {
    fetchBtn.disabled = true;
    showBanner(
      `This website is not supported. Open ${PARENT_WEBSITE_URL} to use this extension.`,
      "info"
    );
  }
}

init();
