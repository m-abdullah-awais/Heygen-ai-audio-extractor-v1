/**
 * HeyGen Audio Extractor
 * Author : Muhammad Abdullah Awais, Full Stack Developer
 * Website: https://www.abdullahawais.com
 * -----------------------------------------------------------------------------
 * background.js: minimal Manifest V3 service worker.
 *
 * Downloading happens from the popup via chrome.downloads, and scanning happens
 * in the content script, so this worker stays lightweight. It is kept as an
 * install-time hook and a clear extension point for future background work.
 */

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[HeyGen Audio Extractor] Installed/updated (${details.reason}).`);
});
