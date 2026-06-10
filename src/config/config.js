/**
 * HeyGen Audio Extractor
 * Author : Muhammad Abdullah Awais, Full Stack Developer
 * Website: https://www.abdullahawais.com
 * -----------------------------------------------------------------------------
 * config.js: Single source of truth for the two configurable values.
 *
 * Replace the placeholders below to retarget the extension to a different
 * site / audio host. If you change PARENT_WEBSITE_URL, you MUST also update
 * the matching patterns in manifest.json ("content_scripts".matches and
 * "host_permissions"); the manifest cannot import JavaScript, so those are
 * the only other place the parent URL appears.
 *
 * NOTE: AUDIO_URL_PREFIX is used internally for matching only. The user never
 * sees raw URLs anywhere in the interface.
 */

// The site the extension is allowed to operate on (no trailing slash).
export const PARENT_WEBSITE_URL = "https://app.heygen.com";

// Only audio whose address begins with this prefix is collected (internal use).
export const AUDIO_URL_PREFIX = "https://resource2.heygen.ai";

// Rendered scene videos are served from this host. Only video addresses that
// begin with this prefix are collected (internal use). The full address,
// including its signed query string, is preserved so playback/download work.
export const VIDEO_URL_PREFIX = "https://heygen-resources-prod.s3-accelerate.amazonaws.com";
