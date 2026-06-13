/**
 * HeyGen Audio & Video Extractor
 * Author : Muhammad Abdullah Awais, Full Stack Developer
 * Website: https://www.abdullahawais.com
 * -----------------------------------------------------------------------------
 * background.js: Manifest V3 service worker.
 *
 * It owns downloading so filenames are GUARANTEED. The popup sends a
 * { type: "DOWNLOAD", url, filename } message; we start the download here and
 * force the final name via chrome.downloads.onDeterminingFilename. That hook
 * takes precedence over the server's Content-Disposition header (and survives
 * redirects), which is why HeyGen's "id=<uuid>.mp3" name no longer wins over
 * our friendly "audio-01-<suffix>.mp3" / "video-01-<suffix>.mp4".
 */

// Maps the URL we kicked off -> the filename we want Chrome to use for it.
const pendingNames = new Map();

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[HeyGen Extractor] Installed/updated (${details.reason}).`);
});

/**
 * Receive download requests from the popup and start them here. Returning the
 * download id (or an error) lets the popup show accurate feedback.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "DOWNLOAD") return; // not for us

  const { url, filename } = message;
  if (filename) pendingNames.set(url, filename);

  chrome.downloads.download({ url, conflictAction: "uniquify" }, (id) => {
    const err = chrome.runtime.lastError;
    if (err || id === undefined) {
      pendingNames.delete(url);
      sendResponse({ ok: false, error: err ? err.message : "Download failed." });
    } else {
      sendResponse({ ok: true, id });
    }
  });

  return true; // keep the channel open for the async callback
});

/**
 * Force our chosen filename. This fires after the MIME type and tentative
 * (server-suggested) name are known, so suggesting here overrides any
 * Content-Disposition name. Matches on both the original and post-redirect URL.
 */
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const name = pendingNames.get(item.url) || pendingNames.get(item.finalUrl);
  if (name) {
    pendingNames.delete(item.url);
    pendingNames.delete(item.finalUrl);
    suggest({ filename: name, conflictAction: "uniquify" });
  } else {
    suggest(); // not one of ours — leave it alone
  }
});
