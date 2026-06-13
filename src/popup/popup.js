/**
 * HeyGen Audio & Video Extractor
 * Author : Muhammad Abdullah Awais, Full Stack Developer
 * Website: https://www.abdullahawais.com
 * -----------------------------------------------------------------------------
 * popup.js: popup controller (ES module).
 *
 * The page scan returns raw URLs (see content.js; that logic is unchanged and
 * is reused for both audio and video, only the prefix differs). This controller
 * keeps those URLs INTERNAL and presents each one as a friendly, numbered,
 * playable + downloadable item. The user never sees a URL.
 *
 * Two tabbed sections:
 *  - Audio  → matches the audio host prefix.
 *  - Video  → matches the rendered-scene video host prefix (signed S3 URL,
 *             query string preserved). Requires the scene to be fully rendered.
 */

import { PARENT_WEBSITE_URL, AUDIO_URL_PREFIX, VIDEO_URL_PREFIX } from "../config/config.js";

// Resolve the content script path once (relative to the extension root).
const CONTENT_SCRIPT_PATH = "src/content/content.js";

// Recognised extensions per media kind; anything else uses the fallback.
const AUDIO_EXTS = ["mp3", "m4a", "wav", "aac", "ogg", "oga", "opus", "flac", "webm", "mp4"];
const VIDEO_EXTS = ["mp4", "mov", "webm", "m4v", "mkv"];

// Inline icons (trusted, static markup).
const ICON_DOWNLOAD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_SUN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
const ICON_MOON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

const THEME_KEY = "heygen-extractor-theme";

// ---- DOM references ----
const bannerEl = document.getElementById("banner");
const themeToggle = document.getElementById("themeToggle");
const tabAudio = document.getElementById("tabAudio");
const tabVideo = document.getElementById("tabVideo");
const panelAudio = document.getElementById("panel-audio");
const panelVideo = document.getElementById("panel-video");

/**
 * Per-kind configuration + live state. Keeps audio and video fully parallel so
 * one set of helpers drives both.
 */
const MEDIA = {
  audio: {
    label: "Audio",
    icon: "🎵",
    prefix: AUDIO_URL_PREFIX,
    fallbackExt: "mp3",
    knownExts: AUDIO_EXTS,
    isVideo: false,
    filter: null, // keep every audio match (unchanged behaviour)
    fetchLabel: "Fetch Audio",
    urls: [],
    fetchBtn: document.getElementById("fetchAudioBtn"),
    downloadAllBtn: document.getElementById("downloadAllAudioBtn"),
    listEl: document.getElementById("audioResults"),
    noteEl: document.getElementById("audioNote"),
  },
  video: {
    label: "Video",
    icon: "🎬",
    prefix: VIDEO_URL_PREFIX,
    fallbackExt: "mp4",
    knownExts: VIDEO_EXTS,
    isVideo: true,
    // Only keep real video files (the bucket may also hold thumbnails, etc.).
    filter: (url) => /\.(mp4|mov|webm|m4v|mkv)(\?|#|$)/i.test(url),
    fetchLabel: "Fetch Video",
    urls: [],
    fetchBtn: document.getElementById("fetchVideoBtn"),
    downloadAllBtn: document.getElementById("downloadAllVideoBtn"),
    listEl: document.getElementById("videoResults"),
    noteEl: null,
  },
};

// One random 6-digit suffix per popup session, shared by every downloaded file
// (audio + video) so a project's files stay grouped, e.g. audio-01-483920.mp3
// and video-01-483920.mp4.
let batchSuffix = "";

/**
 * Generate a random numeric suffix (default 6 digits).
 * @param {number} [len]
 * @returns {string}
 */
function randomSuffix(len = 6) {
  let out = "";
  for (let i = 0; i < len; i++) out += Math.floor(Math.random() * 10);
  return out;
}

// ---- Banner ----
function showBanner(message, type = "info") {
  bannerEl.textContent = message;
  bannerEl.className = `banner banner--${type} is-visible`;
}
function hideBanner() {
  bannerEl.className = "banner banner--info";
  bannerEl.textContent = "";
}

// ---- Theme ----
function getEffectiveTheme() {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyTheme(theme, persist = true) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggle.innerHTML = theme === "dark" ? ICON_SUN : ICON_MOON;
  themeToggle.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable; toggle still works this session */
    }
  }
}
function toggleTheme() {
  applyTheme(getEffectiveTheme() === "dark" ? "light" : "dark");
}

// ---- Tabs ----
function switchTab(kind) {
  const isAudio = kind === "audio";
  tabAudio.classList.toggle("is-active", isAudio);
  tabVideo.classList.toggle("is-active", !isAudio);
  tabAudio.setAttribute("aria-selected", String(isAudio));
  tabVideo.setAttribute("aria-selected", String(!isAudio));
  panelAudio.hidden = !isAudio;
  panelVideo.hidden = isAudio;
}

// ---- Active-tab helpers ----
function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
}
function sendScanMessage(tabId, prefix) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "SCAN", prefix }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(response);
    });
  });
}
function injectContentScript(tabId) {
  return chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_PATH] });
}

// ---- Downloads ----
function fileExtFromUrl(url, fallback, allowed) {
  try {
    const pathname = new URL(url).pathname; // drops the query string
    const match = pathname.match(/\.([a-z0-9]{1,5})$/i);
    if (match) {
      const ext = match[1].toLowerCase();
      if (allowed.includes(ext)) return ext;
    }
  } catch {
    /* malformed URL → use fallback */
  }
  return fallback;
}
function friendlyFileName(cfg, index, url) {
  const num = String(index).padStart(2, "0");
  const ext = fileExtFromUrl(url, cfg.fallbackExt, cfg.knownExts);
  // e.g. audio-01-483920.mp3  /  video-01-483920.mp4
  return `${cfg.label.toLowerCase()}-${num}-${batchSuffix}.${ext}`;
}
function downloadFile(url, filename) {
  // Route through the background worker so the filename is enforced via
  // onDeterminingFilename (beats the server's Content-Disposition name).
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "DOWNLOAD", url, filename }, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else if (!resp || !resp.ok) reject(new Error(resp && resp.error ? resp.error : "Download failed."));
      else resolve(resp.id);
    });
  });
}

// ---- Rendering ----
function renderState(cfg, emoji, title, sub) {
  cfg.listEl.replaceChildren();
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
  cfg.listEl.appendChild(li);
}

function buildCard(cfg, url, index) {
  const li = document.createElement("li");
  li.className = "media-item";

  const head = document.createElement("div");
  head.className = "media-item__head";

  const label = document.createElement("span");
  label.className = "media-item__label";
  const icon = document.createElement("span");
  icon.className = "media-item__icon";
  icon.textContent = cfg.icon;
  icon.setAttribute("aria-hidden", "true");
  const labelText = document.createElement("span");
  labelText.textContent = `${cfg.label} ${index}`;
  label.append(icon, labelText);

  const downloadBtn = document.createElement("button");
  downloadBtn.className = "btn-download";
  downloadBtn.type = "button";
  downloadBtn.innerHTML = `${ICON_DOWNLOAD}<span>Download</span>`;
  downloadBtn.addEventListener("click", async () => {
    downloadBtn.disabled = true;
    try {
      await downloadFile(url, friendlyFileName(cfg, index, url));
      downloadBtn.innerHTML = `${ICON_CHECK}<span>Saved</span>`;
      downloadBtn.classList.add("is-done");
      setTimeout(() => {
        downloadBtn.innerHTML = `${ICON_DOWNLOAD}<span>Download</span>`;
        downloadBtn.classList.remove("is-done");
      }, 1600);
    } catch (error) {
      showBanner(`Could not download this ${cfg.label.toLowerCase()}. Please try again.`, "error");
      console.error("[HeyGen Extractor]", error);
    } finally {
      downloadBtn.disabled = false;
    }
  });

  head.append(label, downloadBtn);

  // Native player. The src is the internal URL (never shown as text).
  const player = document.createElement(cfg.isVideo ? "video" : "audio");
  player.className = cfg.isVideo ? "media-item__video" : "media-item__player";
  player.controls = true;
  player.preload = cfg.isVideo ? "metadata" : "none";
  // Remove the player's own download option so the only way to download is our
  // button (which names files audio-01-… / video-01-…). The native menu would
  // otherwise save the file under its raw URL name (e.g. "id=<uuid>.mp3").
  player.setAttribute("controlsList", "nodownload noplaybackrate");
  player.disablePictureInPicture = true;
  // Also block the right-click "Save as…" route for the same reason.
  player.addEventListener("contextmenu", (e) => e.preventDefault());
  player.src = url;

  li.append(head, player);
  return li;
}

function renderItems(cfg) {
  if (cfg.urls.length === 0) {
    const sub = cfg.isVideo
      ? "Render the scene fully (see the steps above), then try again."
      : "Make sure the voice has finished generating, then try again.";
    renderState(cfg, "🔇", `No ${cfg.label.toLowerCase()} found`, sub);
    cfg.downloadAllBtn.hidden = true;
    if (cfg.noteEl) cfg.noteEl.hidden = true;
    return;
  }

  cfg.listEl.replaceChildren();
  cfg.urls.forEach((url, i) => cfg.listEl.appendChild(buildCard(cfg, url, i + 1)));
  cfg.downloadAllBtn.hidden = false;
  if (cfg.noteEl) cfg.noteEl.hidden = false;
}

// ---- Fetch ----
function setFetchBusy(cfg, busy) {
  cfg.fetchBtn.disabled = busy;
  cfg.fetchBtn.innerHTML = busy
    ? '<span class="btn__icon" aria-hidden="true">&#x231b;</span> Scanning…'
    : `<span class="btn__icon" aria-hidden="true">&#x21bb;</span> ${cfg.fetchLabel}`;
}

async function handleFetch(kind) {
  const cfg = MEDIA[kind];
  setFetchBusy(cfg, true);
  hideBanner();
  cfg.downloadAllBtn.hidden = true;
  if (cfg.noteEl) cfg.noteEl.hidden = true;

  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id) throw new Error("Could not access the active tab.");

    let response;
    try {
      response = await sendScanMessage(tab.id, cfg.prefix);
    } catch {
      // Content script not loaded yet (page opened before install) → inject + retry.
      await injectContentScript(tab.id);
      response = await sendScanMessage(tab.id, cfg.prefix);
    }
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Scan failed.");
    }

    let urls = response.urls || [];
    if (cfg.filter) urls = urls.filter(cfg.filter);
    cfg.urls = urls;
    renderItems(cfg);

    if (urls.length > 0) {
      showBanner(`${cfg.label} found: ${urls.length} file${urls.length === 1 ? "" : "s"}.`, "success");
    } else {
      hideBanner();
    }
  } catch (error) {
    cfg.urls = [];
    cfg.downloadAllBtn.hidden = true;
    if (cfg.noteEl) cfg.noteEl.hidden = true;
    renderState(cfg, "⚠️", "Couldn't scan this page", "Open an app.heygen.com page, reload it, then try again.");
    showBanner("Couldn't scan this page. Make sure you're on an app.heygen.com page and try reloading it.", "error");
    console.error("[HeyGen Extractor]", error);
  } finally {
    setFetchBusy(cfg, false);
  }
}

async function handleDownloadAll(kind) {
  const cfg = MEDIA[kind];
  if (cfg.urls.length === 0) return;

  cfg.downloadAllBtn.disabled = true;
  const original = cfg.downloadAllBtn.innerHTML;
  cfg.downloadAllBtn.innerHTML = '<span class="btn__icon" aria-hidden="true">&#x231b;</span> Downloading…';

  let started = 0;
  for (let i = 0; i < cfg.urls.length; i++) {
    try {
      await downloadFile(cfg.urls[i], friendlyFileName(cfg, i + 1, cfg.urls[i]));
      started++;
    } catch (error) {
      console.error("[HeyGen Extractor]", error);
    }
  }

  cfg.downloadAllBtn.innerHTML = original;
  cfg.downloadAllBtn.disabled = false;

  if (started === cfg.urls.length) {
    showBanner(`Downloading all ${started} ${cfg.label.toLowerCase()} file${started === 1 ? "" : "s"}.`, "success");
  } else {
    showBanner(`Started ${started} of ${cfg.urls.length} downloads. Please retry the rest.`, "error");
  }
}

// ---- Init ----
async function init() {
  // One shared suffix for the whole session.
  batchSuffix = randomSuffix();

  // Theme: restore the saved choice (if any) and reflect it on the toggle.
  let savedTheme = null;
  try {
    savedTheme = localStorage.getItem(THEME_KEY);
  } catch {
    /* ignore */
  }
  if (savedTheme === "light" || savedTheme === "dark") applyTheme(savedTheme, false);
  else themeToggle.innerHTML = getEffectiveTheme() === "dark" ? ICON_SUN : ICON_MOON;

  themeToggle.addEventListener("click", toggleTheme);
  tabAudio.addEventListener("click", () => switchTab("audio"));
  tabVideo.addEventListener("click", () => switchTab("video"));
  MEDIA.audio.fetchBtn.addEventListener("click", () => handleFetch("audio"));
  MEDIA.video.fetchBtn.addEventListener("click", () => handleFetch("video"));
  MEDIA.audio.downloadAllBtn.addEventListener("click", () => handleDownloadAll("audio"));
  MEDIA.video.downloadAllBtn.addEventListener("click", () => handleDownloadAll("video"));

  const tab = await getActiveTab();
  const url = tab && tab.url ? tab.url : "";

  if (!url.startsWith(PARENT_WEBSITE_URL)) {
    MEDIA.audio.fetchBtn.disabled = true;
    MEDIA.video.fetchBtn.disabled = true;
    renderState(MEDIA.audio, "🚫", "Website not supported", "Open app.heygen.com to use this extension.");
    renderState(MEDIA.video, "🚫", "Website not supported", "Open app.heygen.com to use this extension.");
    showBanner(`This website is not supported. Open ${PARENT_WEBSITE_URL} to use this extension.`, "info");
    return;
  }

  renderState(MEDIA.audio, "🎧", "Ready to fetch audio", 'Click "Fetch Audio" to find every audio file on this page.');
  renderState(MEDIA.video, "🎬", "Ready to fetch video", "Render the scene first, then click “Fetch Video”.");
}

init();
