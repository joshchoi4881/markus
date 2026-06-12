/**
 * Path resolution for the automation pipeline.
 *
 * ALL scripts use these functions to resolve data paths.
 * Single source of truth — change the layout here, everything follows.
 *
 * Layout:
 *   ~/markus/apps/{app}/{platform}/              — per-platform data
 *   ~/markus/apps/{app}/app.json                 — app config
 *   ~/markus/apps/{app}/shared-failures.json
 *   ~/markus/apps/{app}/insights.json            — cross-platform strategy notes
 *   ~/markus/apps/{app}/x-research-signals.json
 *   ~/markus/apps/{app}/reports/                 — cross-platform analysis reports
 *   ~/markus/apps/cache/                         — shared API response cache
 */

const path = require('path');
const fs = require('fs');

const HOME = process.env.HOME || '';
const DATA_ROOT = process.env.APPS_DATA_ROOT || path.join(HOME, 'markus', 'apps');

/**
 * Root directory for an app's data.
 * e.g. ~/markus/apps/dropspace/
 */
function appRoot(appName) {
  return path.join(DATA_ROOT, appName);
}

/**
 * Per-platform data directory.
 * e.g. ~/markus/apps/dropspace/tiktok/
 */
function platformDir(appName, platform) {
  return path.join(DATA_ROOT, appName, platform);
}

/**
 * App config file.
 * e.g. ~/markus/apps/dropspace/app.json
 */
function appConfigPath(appName) {
  return path.join(appRoot(appName), 'app.json');
}

/**
 * Load app.json config. Returns null if not found.
 */
function loadAppConfig(appName) {
  try {
    return JSON.parse(fs.readFileSync(appConfigPath(appName), 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Shared failures file for an app.
 * e.g. ~/markus/apps/dropspace/shared-failures.json
 */
function sharedFailuresPath(appName) {
  return path.join(appRoot(appName), 'shared-failures.json');
}

/**
 * Cross-platform strategy insights for an app.
 * e.g. ~/markus/apps/dropspace/insights.json
 */
function insightsPath(appName) {
  return path.join(appRoot(appName), 'insights.json');
}

/**
 * X research signals file for an app.
 * e.g. ~/markus/apps/dropspace/x-research-signals.json
 */
function xResearchSignalsPath(appName) {
  return path.join(appRoot(appName), 'x-research-signals.json');
}

/**
 * Cross-platform reports directory for an app.
 * e.g. ~/markus/apps/dropspace/reports/
 */
function reportsDir(appName) {
  return path.join(appRoot(appName), 'reports');
}

/**
 * Shared cache directory.
 * e.g. ~/markus/apps/cache/
 */
function cacheDir() {
  return path.join(DATA_ROOT, 'cache');
}

/**
 * Self-improve cache path for an app.
 * e.g. ~/markus/apps/cache/self-improve-dropspace-14d.json
 */
function selfImproveCachePath(appName, days) {
  return path.join(cacheDir(), `self-improve-${appName}-${days}d.json`);
}

/**
 * X research snapshot directory for an app.
 * e.g. ~/markus/apps/dropspace/tiktok/research/  (platform-specific)
 * or ~/markus/apps/dropspace/research/             (app-level)
 */
function researchDir(appName, platform) {
  if (platform) return path.join(platformDir(appName, platform), 'research');
  return path.join(appRoot(appName), 'research');
}

/**
 * Strategy.json for a platform.
 * e.g. ~/markus/apps/dropspace/tiktok/strategy.json
 */
function strategyPath(appName, platform) {
  return path.join(platformDir(appName, platform), 'strategy.json');
}

/**
 * Posts.json for a platform.
 */
function postsPath(appName, platform) {
  return path.join(platformDir(appName, platform), 'posts.json');
}

/**
 * Failures.json for a platform.
 */
function failuresPath(appName, platform) {
  return path.join(platformDir(appName, platform), 'failures.json');
}

/**
 * Experiment tracking for a platform.
 */
function experimentsPath(appName, platform) {
  return path.join(platformDir(appName, platform), 'experiments.json');
}

/**
 * Post assets directory for a specific post.
 */
function postAssetsDir(appName, platform, timestamp) {
  return path.join(platformDir(appName, platform), 'posts', timestamp);
}

/**
 * Posts directory root for a platform.
 */
function postsAssetsRoot(appName, platform) {
  return path.join(platformDir(appName, platform), 'posts');
}

/**
 * Get list of enabled platforms for an app from app.json.
 */
function getEnabledPlatforms(appName) {
  const config = loadAppConfig(appName);
  if (!config || !config.platforms) return [];
  return Object.entries(config.platforms)
    .filter(([_, cfg]) => cfg.enabled !== false)
    .map(([name]) => name);
}

/**
 * Discover all configured apps in DATA_ROOT.
 * Returns array of { name, config, pipelineType }.
 * Optional filter: 'ai-generated' or 'manual'.
 */
function getAllApps(filterType) {
  const fs = require('fs');
  const SKIP_DIRS = new Set(['cache', 'node_modules', '.git']);
  const results = [];
  try {
    const dirs = fs.readdirSync(DATA_ROOT, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory() || SKIP_DIRS.has(d.name) || d.name.startsWith('.')) continue;
      const configPath = appConfigPath(d.name);
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const pipelineType = config.pipelineType || 'ai-generated';
        if (filterType && pipelineType !== filterType) continue;
        results.push({ name: d.name, config, pipelineType });
      } catch { /* no valid app.json, skip */ }
    }
  } catch { /* DATA_ROOT doesn't exist */ }
  return results;
}

module.exports = {
  HOME,
  DATA_ROOT,
  appRoot,
  platformDir,
  appConfigPath,
  loadAppConfig,
  sharedFailuresPath,
  insightsPath,
  xResearchSignalsPath,
  reportsDir,
  cacheDir,
  selfImproveCachePath,
  researchDir,
  strategyPath,
  postsPath,
  failuresPath,
  experimentsPath,
  postAssetsDir,
  postsAssetsRoot,
  getEnabledPlatforms,
  getAllApps,
};
