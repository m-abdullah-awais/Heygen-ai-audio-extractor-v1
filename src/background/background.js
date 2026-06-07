/**
 * HeyGen Audio URL Extractor
 * Author : Muhammad Abdullah Awais, Full Stack Developer
 * Website: https://www.abdullahawais.com
 * -----------------------------------------------------------------------------
 * background.js: minimal Manifest V3 service worker.
 *
 * The DOM-only / on-click design does not require persistent background work:
 * scanning happens in the content script and the injection fallback lives in
 * popup.js (via chrome.scripting). This worker is intentionally lightweight,
 * kept as an install-time hook and a clear extension point (e.g. if network
 * capture via chrome.webRequest is added later).
 */

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[HeyGen Audio Extractor] Installed/updated (${details.reason}).`);
});
