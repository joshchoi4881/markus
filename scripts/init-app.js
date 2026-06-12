#!/usr/bin/env node
/**
 * Initialize a new app for the automation pipeline.
 *
 * Creates the directory structure, app.json template, and empty data files
 * for all specified platforms.
 *
 * Usage:
 *   node init-app.js --app myapp --platforms tiktok,instagram,twitter --notify slack:C0CHANNEL_ID
 *   node init-app.js --app myapp --platforms all --notify telegram:YOUR_CHAT_ID
 *   node init-app.js --app myapp --platforms tiktok,twitter  (no notifications)
 */

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('../core/helpers');
const pathsLib = require('../core/paths');
const { getAllPlatforms, getVisualPlatforms } = require('../core/platforms');
const { FORMATS } = require('../core/formats');

const { getArg } = parseArgs();
const appName = getArg('app');
const platformsArg = getArg('platforms') || 'all';
const notifyArg = getArg('notify'); // format: "channel:target" e.g. "slack:C0CHANNEL_ID" or "telegram:12345"

if (!appName) {
  console.error('Usage: node init-app.js --app <name> --platforms <tiktok,instagram,...|all> [--notify channel:target]');
  console.error('');
  console.error('Examples:');
  console.error('  node init-app.js --app myapp --platforms tiktok,twitter --notify slack:C0ABC123');
  console.error('  node init-app.js --app myapp --platforms all --notify telegram:YOUR_CHAT_ID');
  console.error('  node init-app.js --app myapp --platforms tiktok,twitter --notify discord:123456789');
  console.error('');
  console.error('Supported channels: slack, telegram, discord, whatsapp, signal');
  process.exit(1);
}

// Parse notification config
let notifications = { channel: '', target: '' };
if (notifyArg) {
  const colonIdx = notifyArg.indexOf(':');
  if (colonIdx > 0) {
    notifications = {
      channel: notifyArg.substring(0, colonIdx),
      target: notifyArg.substring(colonIdx + 1),
    };
  } else {
    console.error(`❌ Invalid --notify format. Use "channel:target" (e.g. "slack:C0ABC123" or "telegram:12345")`);
    process.exit(1);
  }
}

const platforms = platformsArg === 'all'
  ? getAllPlatforms()
  : platformsArg.split(',').map(s => s.trim());

const visualPlatforms = getVisualPlatforms();

// Create directories
const appRoot = pathsLib.appRoot(appName);
const dirs = [
  appRoot,
  pathsLib.reportsDir(appName),
  pathsLib.cacheDir(),
];

for (const platform of platforms) {
  dirs.push(pathsLib.platformDir(appName, platform));
  dirs.push(pathsLib.postsAssetsRoot(appName, platform));
  if (platform === 'twitter') {
    dirs.push(pathsLib.researchDir(appName, 'twitter'));
  }
}

for (const d of dirs) {
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
    console.log(`📁 ${d}`);
  }
}

// Create app.json template
const appConfigFile = pathsLib.appConfigPath(appName);
if (!fs.existsSync(appConfigFile)) {
  const platformConfig = {};
  for (const p of platforms) {
    const isVisual = visualPlatforms.includes(p);
    platformConfig[p] = {
      enabled: true,
      contentSource: 'ai-generated',
      useDropspacePlatform: true,
      postingTimes: isVisual ? ['08:00'] : ['09:00'],
      ...(p === 'linkedin' ? { weekdaysOnly: true } : {}),
      _note: "Set useDropspacePlatform:true for Dropspace managed accounts, OR replace with connectionId:'your-uuid' from Dropspace dashboard → Connections",
    };
  }

  const template = {
    name: appName.charAt(0).toUpperCase() + appName.slice(1),
    pipelineType: 'ai-generated',
    description: '',
    audience: '',
    problem: '',
    differentiator: '',
    voice: '',
    url: '',
    category: 'saas',
    monetization: 'subscription',
    apiKeyEnv: `DROPSPACE_API_KEY_${appName.toUpperCase()}`,
    notifications,
    minQueue: 7,
    skipDays: [0],
    cta: { default: '' },
    integrations: {},
    platforms: platformConfig,
    utmTemplate: `https://example.com?utm_source={platform}&utm_medium=social&utm_campaign=${appName}`,
  };

  fs.writeFileSync(appConfigFile, JSON.stringify(template, null, 2));
  console.log(`📝 ${appConfigFile}`);
} else {
  console.log(`⏭ ${appConfigFile} already exists`);
}

// Create empty data files for each platform
for (const platform of platforms) {
  const files = {
    'strategy.json': { postQueue: [] },
    'posts.json': { posts: [] },
    'failures.json': { failures: [] },
  };

  files['experiments.json'] = { active: [], completed: [], candidates: [], killed: [] };

  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(pathsLib.platformDir(appName, platform), filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
      console.log(`📝 ${platform}/${filename}`);
    }
  }
}

// Create shared files
const sharedFiles = {
  [pathsLib.sharedFailuresPath(appName)]: { failures: [] },
  [pathsLib.insightsPath(appName)]: { lastUpdated: null },
};

for (const [filePath, content] of Object.entries(sharedFiles)) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
    console.log(`📝 ${path.basename(filePath)}`);
  }
}

console.log(`\n✅ App "${appName}" initialized with ${platforms.length} platforms: ${platforms.join(', ')}`);
if (notifications.channel) {
  console.log(`📢 Notifications: ${notifications.channel} → ${notifications.target}`);
} else {
  console.log(`📢 No notifications configured. Add --notify channel:target or edit app.json notifications.`);
}
console.log(`\nData root: ${pathsLib.DATA_ROOT}`);
console.log(`App config: ${appConfigFile}`);
console.log(`\nNext steps:`);
console.log(`  1. Edit ${appConfigFile} with your app details (description, voice, posting times)`);
console.log(`  2. Add your Dropspace API key to load-env.sh:`);
console.log(`     export DROPSPACE_API_KEY_${appName.toUpperCase()}="ds_live_..."`);
console.log(`  3. Run: node ~/markus/scripts/test-pipeline.js --app ${appName}`);
console.log(`  4. Set up crons: node ~/markus/scripts/setup-crons.js`);
