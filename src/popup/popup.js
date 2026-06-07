/**
 * HeyGen Audio Extractor
 * Author : Muhammad Abdullah Awais, Full Stack Developer
 * Website: https://www.abdullahawais.com
 * -----------------------------------------------------------------------------
 * popup.js: popup controller (ES module).
 *
 * The page scan still returns raw URLs (see content.js — that logic is
 * unchanged). This controller keeps those URLs INTERNAL and presents each one
 * as a friendly audio item: 🎵 Audio 1, Audio 2, ... with a native player and
 * a direct Download button. The user never sees a URL.
 *
 * Responsibilities:
 *  - Enforce the website restriction at the popup level.
 *  - Ask the content script to scan the page when "Fetch Audio" is clicked.
 *  - Render each discovered audio as a playable + downloadable item, in order.
 *  - Download individually or all at once with friendly sequential filenames.
 *  - Handle errors gracefully, never exposing technical details or URLs.
 */

import { PARENT_WEBSITE_URL, AUDIO_URL_PREFIX } from "../config/config.js";

// Resolve the content script path once (relative to the extension root).
const CONTENT_SCRIPT_PATH = "src/content/content.js";

// Audio extensions we recognise; anything else falls back to ".mp3".
const KNOWN_AUDIO_EXTS = ["mp3", "m4a", "wav", "aac", "ogg", "oga", "opus", "flac", "webm", "mp4"];

// Inline download icon (trusted, static markup).
const ICON_DOWNLOAD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
// Sun (shown while dark → click for light) and moon (shown while light → click for dark).
const ICON_SUN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
const ICON_MOON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

// Key used to remember the user's manual theme choice across popup sessions.
const THEME_KEY = "heygen-audio-extractor-theme";

// ---- DOM references ----
const bannerEl = document.getElementById("banner");
const fetchBtn = document.getElementById("fetchBtn");
const downloadAllBtn = document.getElementById("downloadAllBtn");
const themeToggle = document.getElementById("themeToggle");
const combineNote = document.getElementById("combineNote");
const resultsEl = document.getElementById("results"); // <ul>

// Internal list of discovered audio URLs (kept private; never displayed).
let audioUrls = [];

// A 6-digit suffix shared by every file in a single fetch, e.g.
// audio-01-483920.mp3, audio-02-483920.mp3, ... A fresh one is generated on
// each fetch so one batch's files are grouped and won't clash with another.
let batchSuffix = "";

/**
 * Generate a random numeric suffix (default 6 digits).
 * @param {number} [len]
 * @returns {string}
 */
function randomSuffix(len = 6) {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += Math.floor(Math.random() * 10);
  }
  return out;
}

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
 * Work out which theme is currently showing: an explicit user choice if set,
 * otherwise whatever the operating system prefers.
 * @returns {"light"|"dark"}
 */
function getEffectiveTheme() {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Apply a theme: set the attribute (so CSS variables switch), update the toggle
 * icon, and remember the choice. The toggle shows the icon for the theme you'd
 * switch TO (moon while light, sun while dark).
 * @param {"light"|"dark"} theme
 * @param {boolean} [persist] save the choice (default true)
 */
function applyTheme(theme, persist = true) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggle.innerHTML = theme === "dark" ? ICON_SUN : ICON_MOON;
  themeToggle.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage may be unavailable; the toggle still works for this session */
    }
  }
}

/**
 * Flip between light and dark based on what is currently showing.
 */
function toggleTheme() {
  applyTheme(getEffectiveTheme() === "dark" ? "light" : "dark");
}

/**
 * Show or hide the "combine the chunks" reminder.
 * @param {boolean} show
 */
function setCombineNoteVisible(show) {
  combineNote.hidden = !show;
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
 * Render a single full-width state card (idle / empty / error).
 * @param {string} emoji
 * @param {string} title
 * @param {string} sub
 */
function renderState(emoji, title, sub) {
  resultsEl.replaceChildren();
  const li = document.createElement("li");
  li.className = "state";
  const e = document.createElement("span");
  e.className = "state__emoji";
  e.textContent = emoji;
  const t = document.createElement("span");
  t.className = "state__title";
  t.textContent = title;
  const s = document.createElement("span");
  s.className = "state__sub";
  s.textContent = sub;
  li.append(e, t, s);
  resultsEl.appendChild(li);
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
 * Work out the file extension for a download from its URL, falling back to
 * "mp3" when the format cannot be determined. (Internal use only.)
 * @param {string} url
 * @returns {string} extension without the dot
 */
function fileExtFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-z0-9]{1,5})$/i);
    if (match) {
      const ext = match[1].toLowerCase();
      if (KNOWN_AUDIO_EXTS.includes(ext)) return ext;
    }
  } catch {
    /* ignore malformed URLs and use the default */
  }
  return "mp3";
}

/**
 * Build the friendly, sequential filename for an audio item. Every file from
 * the same fetch shares one random 6-digit suffix, e.g. "audio-01-483920.m4a".
 * @param {number} index 1-based position
 * @param {string} url internal source URL
 * @returns {string} e.g. "audio-01-483920.m4a"
 */
function friendlyFileName(index, url) {
  const num = String(index).padStart(2, "0");
  return `audio-${num}-${batchSuffix}.${fileExtFromUrl(url)}`;
}

/**
 * Download one audio file directly (no new tab, no redirect).
 * @param {string} url internal source URL
 * @param {string} filename friendly name
 * @returns {Promise<number>} the download id
 */
function downloadAudio(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "uniquify" }, (id) => {
      const err = chrome.runtime.lastError;
      if (err || id === undefined) {
        reject(new Error(err ? err.message : "Download failed."));
        return;
      }
      resolve(id);
    });
  });
}

/**
 * Build one audio item card (label + native player + download button).
 * @param {string} url internal source URL
 * @param {number} index 1-based position (order matters for combining later)
 * @returns {HTMLLIElement}
 */
function buildAudioItem(url, index) {
  const li = document.createElement("li");
  li.className = "audio-item";

  // Header row: "🎵 Audio N"  +  Download button.
  const head = document.createElement("div");
  head.className = "audio-item__head";

  const label = document.createElement("span");
  label.className = "audio-item__label";
  const icon = document.createElement("span");
  icon.className = "audio-item__icon";
  icon.textContent = "🎵";
  icon.setAttribute("aria-hidden", "true");
  const labelText = document.createElement("span");
  labelText.textContent = `Audio ${index}`;
  label.append(icon, labelText);

  const downloadBtn = document.createElement("button");
  downloadBtn.className = "btn-download";
  downloadBtn.type = "button";
  downloadBtn.innerHTML = `${ICON_DOWNLOAD}<span>Download</span>`;
  downloadBtn.addEventListener("click", async () => {
    downloadBtn.disabled = true;
    try {
      await downloadAudio(url, friendlyFileName(index, url));
      downloadBtn.innerHTML = `${ICON_CHECK}<span>Saved</span>`;
      downloadBtn.classList.add("is-done");
      setTimeout(() => {
        downloadBtn.innerHTML = `${ICON_DOWNLOAD}<span>Download</span>`;
        downloadBtn.classList.remove("is-done");
      }, 1600);
    } catch (error) {
      showBanner("Could not download this audio. Please try again.", "error");
      console.error("[HeyGen Audio Extractor]", error);
    } finally {
      downloadBtn.disabled = false;
    }
  });

  head.append(label, downloadBtn);

  // Native audio player. preload="none" avoids fetching every clip at once;
  // the src is the internal URL but it is never shown as text.
  const player = document.createElement("audio");
  player.className = "audio-item__player";
  player.controls = true;
  player.preload = "none";
  player.src = url;

  li.append(head, player);
  return li;
}

/**
 * Render all discovered audio as numbered, playable, downloadable items.
 * @param {string[]} urls internal source URLs, in discovery order
 */
function renderAudioItems(urls) {
  if (urls.length === 0) {
    renderState("🔇", "No audio files found", "Make sure the voice has finished generating, then try again.");
    downloadAllBtn.hidden = true;
    setCombineNoteVisible(false);
    return;
  }

  resultsEl.replaceChildren();
  urls.forEach((url, i) => resultsEl.appendChild(buildAudioItem(url, i + 1)));
  downloadAllBtn.hidden = false;
  setCombineNoteVisible(true);
}

/**
 * Main fetch handler: scan the active tab and render the audio items.
 */
async function handleFetch() {
  setFetchBusy(true);
  hideBanner();
  // Hide bulk download until this scan actually returns audio.
  downloadAllBtn.hidden = true;
  setCombineNoteVisible(false);

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

    audioUrls = response.urls || [];
    // One shared suffix for this whole batch of files.
    batchSuffix = randomSuffix();
    renderAudioItems(audioUrls);

    if (audioUrls.length > 0) {
      showBanner(`Audio found: ${audioUrls.length} file${audioUrls.length === 1 ? "" : "s"}.`, "success");
    } else {
      hideBanner();
    }
  } catch (error) {
    audioUrls = [];
    downloadAllBtn.hidden = true;
    setCombineNoteVisible(false);
    renderState("⚠️", "Couldn't scan this page", "Open an app.heygen.com page, reload it, then try again.");
    showBanner("Couldn't scan this page. Make sure you're on an app.heygen.com page and try reloading it.", "error");
    console.error("[HeyGen Audio Extractor]", error);
  } finally {
    setFetchBusy(false);
  }
}

/**
 * Download every discovered audio file, preserving order and numbering.
 */
async function handleDownloadAll() {
  if (audioUrls.length === 0) return;

  downloadAllBtn.disabled = true;
  const original = downloadAllBtn.innerHTML;
  downloadAllBtn.innerHTML = '<span class="btn__icon" aria-hidden="true">&#x231b;</span> Downloading…';

  let started = 0;
  for (let i = 0; i < audioUrls.length; i++) {
    try {
      await downloadAudio(audioUrls[i], friendlyFileName(i + 1, audioUrls[i]));
      started++;
    } catch (error) {
      console.error("[HeyGen Audio Extractor]", error);
    }
  }

  downloadAllBtn.innerHTML = original;
  downloadAllBtn.disabled = false;

  if (started === audioUrls.length) {
    showBanner(`Downloading all ${started} audio file${started === 1 ? "" : "s"}.`, "success");
  } else {
    showBanner(`Started ${started} of ${audioUrls.length} downloads. Please retry the rest.`, "error");
  }
}

/**
 * On popup open: enforce the website restriction and show an idle state.
 */
async function init() {
  // Theme: restore the saved choice (if any) and reflect it on the toggle.
  // With no saved choice we leave the system preference in charge but still
  // show the correct icon for what's currently displayed.
  let savedTheme = null;
  try {
    savedTheme = localStorage.getItem(THEME_KEY);
  } catch {
    /* storage unavailable; fall back to system preference */
  }
  if (savedTheme === "light" || savedTheme === "dark") {
    applyTheme(savedTheme, false);
  } else {
    themeToggle.innerHTML = getEffectiveTheme() === "dark" ? ICON_SUN : ICON_MOON;
  }

  fetchBtn.addEventListener("click", handleFetch);
  downloadAllBtn.addEventListener("click", handleDownloadAll);
  themeToggle.addEventListener("click", toggleTheme);

  const tab = await getActiveTab();
  const url = tab && tab.url ? tab.url : "";

  if (!url.startsWith(PARENT_WEBSITE_URL)) {
    fetchBtn.disabled = true;
    renderState("🚫", "Website not supported", "Open app.heygen.com to use this extension.");
    showBanner(`This website is not supported. Open ${PARENT_WEBSITE_URL} to use this extension.`, "info");
    return;
  }

  renderState("🎧", "Ready to fetch audio", 'Click "Fetch Audio" to find every audio file on this page.');
}

init();
