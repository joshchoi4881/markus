/**
 * Shared helpers for all platform automation skills.
 *
 * Platform-specific helpers extend this base by providing their own HOOK_PATTERNS
 * and CTA patterns. Import from here for common utilities.
 */

// ── ET Timezone Helpers ──
const TZ = 'America/New_York';

function etDate(d) {
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

function etHour(d) {
  return parseInt(d.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TZ }));
}

function etTimestamp(d) {
  return d.toLocaleString('en-CA', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .replace(',', '').replace(' ', 'T').replace(/:/g, '-');
}

/**
 * Check if a date falls on a weekday (Mon-Fri) in ET.
 * @param {Date|string} [d] - Date object, date string (YYYY-MM-DD), or omit for today.
 */
function isWeekday(d) {
  if (!d) d = new Date();
  if (typeof d === 'string') {
    const parsed = new Date(d + 'T12:00:00Z');
    const etDay = new Date(parsed.toLocaleString('en-US', { timeZone: TZ })).getDay();
    return etDay !== 0 && etDay !== 6;
  }
  const day = new Date(d.toLocaleString('en-US', { timeZone: TZ })).getDay();
  return day >= 1 && day <= 5;
}

/**
 * Convert "HH:MM" ET on a given date string (YYYY-MM-DD) to an ISO datetime string.
 */
/**
 * Convert a date + ET time string to an ISO UTC timestamp.
 * Adds ±30 min random jitter to make posting times look natural.
 * Pass jitter=false to disable (e.g. for dedup checks).
 */
function toISOSchedule(date, timeStr, { jitter = true } = {}) {
  const [h, m] = timeStr.split(':').map(Number);
  const year = parseInt(date.split('-')[0]);
  const month = parseInt(date.split('-')[1]) - 1;
  const day = parseInt(date.split('-')[2]);
  const tempUtc = new Date(Date.UTC(year, month, day, h, m, 0));
  const etStr = tempUtc.toLocaleString('en-US', { timeZone: TZ });
  const etParsed = new Date(etStr);
  const offsetMs = tempUtc.getTime() - etParsed.getTime();
  const utc = new Date(Date.UTC(year, month, day, h, m, 0) + offsetMs);

  if (jitter) {
    // ±15 minutes (random offset in ms)
    const jitterMs = Math.round((Math.random() * 30 - 15) * 60 * 1000);
    utc.setTime(utc.getTime() + jitterMs);
  }

  return utc.toISOString();
}

// ── JSON I/O ──
const fs = require('fs');
const path = require('path');

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch { return fallback; }
}

function saveJSON(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// ── CLI Helpers ──
function parseArgs(argv) {
  const args = argv || process.argv.slice(2);
  return {
    args,
    getArg(name) {
      const idx = args.indexOf(`--${name}`);
      return idx !== -1 ? args[idx + 1] : null;
    },
    hasFlag(name) {
      return args.includes(`--${name}`);
    }
  };
}

// ── Referrer → Platform Mapping ──
// Ordered array of tuples — more specific domains MUST come before general ones.
// Object key iteration order is spec-guaranteed for string keys in insertion order,
// but tuples are explicit and unambiguous.
const REFERRER_RULES = [
  // OAuth/auth redirects — MUST be before platform rules (order matters)
  ['accounts.google', 'google_oauth'],
  ['accounts.youtube', 'google_oauth'],
  ['tagassistant.google', 'google_tagassistant'],
  // Platforms
  ['tiktok.com', 'tiktok'],
  ['vm.tiktok', 'tiktok'],
  ['twitter.com', 'twitter'],
  ['x.com', 'twitter'],
  ['t.co', 'twitter'],
  ['instagram.com', 'instagram'],
  ['l.facebook.com', 'facebook'],
  ['facebook.com', 'facebook'],
  ['fb.com', 'facebook'],
  ['linkedin.com', 'linkedin'],
  ['lnkd.in', 'linkedin'],
  ['reddit.com', 'reddit'],
  ['youtube.com', 'youtube'],
  ['youtu.be', 'youtube'],
  ['producthunt.com', 'producthunt'],
  ['news.ycombinator.com', 'hackernews'],
  // Google: specific before general (order matters)
  ['google.com/search', 'google_organic'],
  ['www.google', 'google_organic'],
  ['google.co.', 'google_organic'],
  ['google.com', 'google_other'],
  ['google.co', 'google_other'],
  ['bing.com', 'bing'],
  // Payment/checkout flows
  ['checkout.stripe.com', 'stripe_checkout'],
];

function referrerToPlatform(referrer) {
  if (!referrer || referrer === '$direct') return 'direct';
  const domain = referrer.toLowerCase();
  for (const [pattern, source] of REFERRER_RULES) {
    if (domain.includes(pattern)) return source;
  }
  return domain;
}

// ── Math Helpers ──
function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ── Failure Recording ──
/**
 * Record a content/strategy rule to failures.json.
 * Use for directive rules and content quality issues.
 * Do NOT use for transient API errors — use recordError() instead.
 */
function recordFailure(failuresPath, rule, context = {}) {
  try {
    const data = loadJSON(failuresPath, { failures: [] });
    data.failures = data.failures || [];
    if (data.failures.some(f => (typeof f === 'string' ? f : f.rule) === rule)) return;
    data.failures.push({ rule, date: new Date().toISOString(), source: context.source || 'auto', ...context });
    if (data.failures.length > 50) data.failures = data.failures.slice(-50);
    saveJSON(failuresPath, data);
    console.log(`  📝 Recorded failure rule: ${rule}`);
  } catch (e) {
    console.warn(`  ⚠️ Could not record failure: ${e.message}`);
  }
}

/**
 * Log a transient error (API failure, timeout, etc.) without polluting failures.json.
 * Writes to a separate errors log for debugging, not fed to the LLM.
 */
function recordError(appName, platform, error, context = {}) {
  try {
    const errLogPath = path.join(
      process.env.HOME || '', 'markus', 'apps', appName, platform, 'errors.log'
    );
    const entry = `[${new Date().toISOString()}] ${error}${context.hook ? ` (hook: ${context.hook})` : ''}\n`;
    fs.appendFileSync(errLogPath, entry);
    console.log(`  📝 Logged error: ${error.substring(0, 100)}`);
  } catch (e) {
    console.warn(`  ⚠️ Could not log error: ${e.message}`);
  }
}

// ── Per-App API Key Resolution ──
/**
 * Resolve the Dropspace API key for a given app.
 * Reads `apiKeyEnv` from app.json and looks it up in process.env.
 * Returns null if the key is not set — never silently falls back to a different account.
 */
function resolveApiKey(appName) {
  if (appName) {
    const pathsLib = require('./paths');
    const config = pathsLib.loadAppConfig(appName);
    if (config && config.apiKeyEnv) {
      const key = process.env[config.apiKeyEnv];
      if (key) return key;
      console.warn(`  ⚠️ ${config.apiKeyEnv} not set for app "${appName}"`);
      return null;
    }
  }
  return null;
}

// ── Deletion Info Extraction ──
// Maps Dropspace analytics API deletion fields to a normalized structure.
// DeletionReason values: not_found, gone, creator_deleted, moderation_removed,
//                        account_deleted, spam_filtered
const DELETION_REASON_LABELS = {
  not_found: 'Not found (404)',
  gone: 'Gone (410)',
  creator_deleted: 'Creator deleted',
  moderation_removed: 'Moderation removed',
  account_deleted: 'Account deleted',
  spam_filtered: 'Spam filtered',
};

/**
 * Extract deletion info from a Dropspace analytics platform entry.
 * Returns { isDeleted, deletedDetectedAt, deletionReason } or null if not deleted.
 */
function extractDeletionInfo(platformData) {
  if (!platformData) return null;
  const isDeleted = platformData.is_deleted === true;
  if (!isDeleted) return null;
  return {
    isDeleted: true,
    deletedDetectedAt: platformData.deleted_detected_at || null,
    deletionReason: platformData.deletion_reason || 'unknown',
    deletionReasonLabel: DELETION_REASON_LABELS[platformData.deletion_reason] || platformData.deletion_reason || 'Unknown',
  };
}

// ── CTA Construction ──
// Single source of truth for UTM URL + CTA text.
// Visual platforms: CTA slide text (no URL in text — link-in-bio or product_url handles it)
// Text platforms: CTA copy + UTM URL appended

/**
 * Build the UTM URL for a given app + platform.
 * Optionally includes utm_content for post-level attribution.
 * @param {object} appConfig - App config from app.json
 * @param {string} platform - Platform name
 * @param {string} [launchId] - Launch ID for post-level tracking (utm_content)
 */
function buildUtmUrl(appConfig, platform, launchId) {
  const baseUrl = appConfig?.url || appConfig?.utmLinks?.[platform];
  if (appConfig?.utmLinks?.[platform]) return appConfig.utmLinks[platform];
  if (!baseUrl) return '';
  let url = `${baseUrl}?utm_source=${platform}&utm_medium=social&utm_campaign=openclaw`;
  if (launchId) url += `&utm_content=${launchId}`;
  return url;
}

/**
 * Build the full CTA for a platform.
 * Visual: returns { text } (text overlay only — engine handles background).
 * Text: returns { text } (copy + UTM URL appended to post body).
 */
function buildCta(platformConfig, appConfig, platform) {
  // App-level CTA (from app.json) takes priority over platform default
  const appCta = appConfig?.cta?.[platform] || appConfig?.cta?.default;
  const copy = appCta || platformConfig?.ctaCopy;
  if (!copy) return null;
  if (platformConfig.type === 'visual') {
    return { text: copy };
  }
  // Text platform: append UTM URL
  const url = buildUtmUrl(appConfig, platform);
  return { text: url ? `${copy} ${url}` : copy };
}

// ── Timeout Constants ──
const TIMEOUTS = {
  imageGen: 180000,        // single image generation (bumped from 130s — Fal.ai nano-banana-2 often exceeds 2min)
  videoGen: 620000,        // video generation
  ffmpeg: 60000,           // ffmpeg operations
  driveUpload: 60000,      // Google Drive upload
  driveDownload: 60000,    // Google Drive download
  apiCall: 30000,          // generic API calls (GA4, Sentry)
  engineExec: 720000,      // engine subprocess (schedule-day calling engines) — 12min for 6-slide visual posts w/ retries
  videoEngineExec: 900000, // video engine subprocess
};

/**
 * Load Google Workspace credentials from 1Password and run a function with them.
 * Handles temp file creation and cleanup.
 * @param {function} fn - async function(credsFile, env) to run with credentials
 * @returns {Promise<*>} result of fn
 */
async function withGWSCredentials(fn) {
  const os = require('os');
  const { execSync } = require('child_process');

  // Option 1: Direct credentials file path (no 1Password needed)
  if (process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE) {
    const credsFile = process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE;
    const env = { ...process.env, GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE: credsFile };
    return await fn(credsFile, env);
  }

  // Option 2: Load from 1Password via GWS_VAULT_PATH
  const gwsVaultPath = process.env.GWS_VAULT_PATH;
  if (!gwsVaultPath) throw new Error('Set GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE (path to creds JSON) or GWS_VAULT_PATH (1Password vault path)');
  // Use OP_SERVICE_ACCOUNT_TOKEN from env first, fall back to parsing shell config
  let opToken = process.env.OP_SERVICE_ACCOUNT_TOKEN || '';
  if (!opToken) {
    const shellFiles = ['~/.bashrc', '~/.zshrc', '~/.bash_profile', '~/.profile'].map(f => f.replace('~', HOME));
    for (const sf of shellFiles) {
      try {
        opToken = execSync(`grep OP_SERVICE_ACCOUNT_TOKEN "${sf}" | head -1 | cut -d'"' -f2`, { encoding: 'utf-8' }).trim();
        if (opToken) break;
      } catch {}
    }
  }
  if (!opToken) throw new Error('OP_SERVICE_ACCOUNT_TOKEN not found in env or shell config files');
  const credsFile = path.join(os.tmpdir(), `gws-creds-${process.pid}-${Date.now()}.json`);
  try {
    execSync(`OP_SERVICE_ACCOUNT_TOKEN="${opToken}" op read 'op://${gwsVaultPath}' > "${credsFile}"`, { encoding: 'utf-8' });
    const env = { ...process.env, GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE: credsFile };
    return await fn(credsFile, env);
  } finally {
    try { fs.unlinkSync(credsFile); } catch {}
  }
}

// Platform-specific character limits for content validation
const CHAR_LIMITS = {
  twitter: { postBody: 25000, threadTweet: 280, maxThreadTweets: 6 },
  linkedin: { postBody: 700 },
  reddit: { postBody: 3000, title: 300 },
  tiktok: { caption: 4000 },
  instagram: { caption: 2200 },
  facebook: { caption: 3000 },
};

// ── Engine Resolution ──
// Determines which create-post engine to use based on format type.
// Used by schedule-day.js.
const SKILLS_DIR = process.env.MARKUS_AGENT_DIR || path.resolve(__dirname, '..');

/**
 * Resolve the create-post engine script path for a given queue entry.
 * @param {string} appName - App name
 * @param {string} platform - Platform name
 * @param {object} appPlatConfig - Platform config from app.json
 * @returns {string} Absolute path to the engine script
 */
function resolveEngine(appName, platform, appPlatConfig, queueIndex) {
  const strategyFile = require('./paths').strategyPath(appName, platform);
  const freshStrategy = loadJSON(strategyFile, { postQueue: [] });
  const idx = queueIndex || 0;
  const nextEntry = (freshStrategy.postQueue || [])[idx];
  const queueFormat = nextEntry && typeof nextEntry === 'object' ? nextEntry.format : null;
  const { resolveDefaultFormat } = require('./formats');
  const resolvedType = queueFormat || resolveDefaultFormat(appName, platform);
  const { FORMATS } = require('./formats');
  const fmtDef = FORMATS[resolvedType];
  const { getPlatformDef } = require('./platforms');
  const platDef = getPlatformDef(platform);

  if (fmtDef?.type === 'video' || resolvedType === 'video') {
    return path.join(SKILLS_DIR, 'engines', 'create-video-post-engine.js');
  } else if (fmtDef?.type === 'visual' || platDef?.type === 'visual') {
    return path.join(SKILLS_DIR, 'engines', 'create-visual-post-engine.js');
  } else {
    return path.join(SKILLS_DIR, 'engines', 'create-text-post-engine.js');
  }
}

module.exports = {
  etDate, etHour, etTimestamp, isWeekday, toISOSchedule,
  loadJSON, saveJSON,
  parseArgs,
  referrerToPlatform,
  mean,
  recordFailure,
  recordError,
  resolveApiKey,
  extractDeletionInfo,
  buildUtmUrl,
  buildCta,
  CHAR_LIMITS,
  resolveEngine,
  withGWSCredentials,
  TIMEOUTS,
  sendSlack,
  sendAppReport,
};

// ── Slack Delivery ──

/**
 * Post a message to a Slack channel using the bot token.
 * @param {string} channel - Slack channel ID (e.g. C09N651N44U)
 * @param {string} text - Message text (Slack mrkdwn)
 * @returns {Promise<{ok: boolean, ts?: string, error?: string}>}
 */
async function sendSlack(channel, text) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error('⚠️ SLACK_BOT_TOKEN not set — skipping Slack delivery');
    return { ok: false, error: 'no token' };
  }
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`⚠️ Slack delivery failed: ${data.error}`);
    } else {
      console.log(`📨 Report sent to Slack ${channel}`);
    }
    return data;
  } catch (e) {
    console.error(`⚠️ Slack delivery error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/**
 * Send a report to an app's configured Slack channel.
 * Reads slackChannel from app.json.
 * @param {string} appName - App name (e.g. 'dropspace')
 * @param {string} text - Report text
 * @returns {Promise<{ok: boolean}>}
 */
async function sendAppReport(appName, text) {
  const pathsLib = require('./paths');
  const appConfigPath = pathsLib.appConfigPath(appName);
  const appConfig = loadJSON(appConfigPath, {});
  const channel = appConfig?.notifications?.slackChannel || appConfig?.notifications?.target || appConfig?.slackChannel;
  if (!channel) {
    console.error(`⚠️ No slackChannel configured for ${appName} — skipping Slack delivery`);
    return { ok: false, error: 'no channel' };
  }
  return sendSlack(channel, text);
}
