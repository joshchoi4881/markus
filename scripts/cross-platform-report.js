#!/usr/bin/env node
/**
 * Cross-Platform Insights Report
 *
 * Reads posts.json from all 6 platforms and generates a cross-platform
 * analysis: universal winners and
 * aggregate funnel metrics.
 *
 * Usage:
 *   node cross-platform-report.js [--app dropspace] [--days 14]
 */

const fs = require('fs');
const path = require('path');
const { loadJSON, etDate, mean, parseArgs } = require('../core/helpers');
const pathsLib = require('../core/paths');
const { getArg } = parseArgs();

try {

const appName = getArg('app') || 'dropspace';
const days = parseInt(getArg('days') || '14');
const { getPlatformDef } = require('../core/platforms');

// Build platform list from app.json enabled platforms
const appConfig = pathsLib.loadAppConfig(appName);
const enabledPlatformNames = appConfig
  ? Object.entries(appConfig.platforms || {}).filter(([_, c]) => c.enabled !== false).map(([n]) => n)
  : ['tiktok', 'twitter', 'instagram', 'linkedin', 'facebook', 'reddit'];

const PLATFORMS = enabledPlatformNames.map(name => ({
  name,
  metric: getPlatformDef(name).primaryMetric,
}));

const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - days);
const cutoffDate = etDate(cutoff);

// Load cached attribution data from last self-improve run (platform-level conversions)
const platformConversions = {};
try {
  const cachePath = pathsLib.selfImproveCachePath(appName, days);
  const cache = loadJSON(cachePath, {});
  if (cache.conversions && Array.isArray(cache.conversions)) {
    for (const c of cache.conversions) {
      const src = c.source || 'unknown';
      if (!platformConversions[src]) platformConversions[src] = { count: 0, revenue: 0 };
      platformConversions[src].count++;
      platformConversions[src].revenue += c.revenue || 0;
    }
  }
} catch { /* no cache */ }

const allPlatformData = {};
const allFormats = new Set();

for (const plat of PLATFORMS) {
  const postsPath = pathsLib.postsPath(appName, plat.name);
  const postsData = loadJSON(postsPath, { posts: [] });

  const recentPosts = postsData.posts.filter(p => p.date >= cutoffDate);

  allPlatformData[plat.name] = {
    posts: recentPosts,
    allPosts: postsData.posts,
    metric: plat.metric,
    totalMetric: recentPosts.reduce((s, p) => s + (p[plat.metric] || 0), 0),
    // Platform-level conversions from referrer/UTM attribution
    totalConversions: (platformConversions[plat.name] || {}).count || 0,
    totalRevenue: (platformConversions[plat.name] || {}).revenue || 0,
  };

  for (const p of recentPosts) {
    if (p.format && p.format !== null) allFormats.add(p.format);
  }
}

// ── Cross-platform format analysis ──
const formatPerformance = {};
for (const format of allFormats) {
  formatPerformance[format] = {};
  for (const plat of PLATFORMS) {
    const platPosts = allPlatformData[plat.name].posts.filter(p => p.format === format);
    if (platPosts.length > 0) {
      const metric = plat.metric;
      const avgMetric = mean(platPosts.map(p => p[metric] || 0));
      formatPerformance[format][plat.name] = {
        posts: platPosts.length,
        avgMetric: Math.round(avgMetric),
        totalConversions: 0, // platform-level only, not per-format
      };
    }
  }
}

// Find universal winners (work on 3+ platforms)
const universalWinners = [];
const platformSpecific = [];
for (const [format, platforms] of Object.entries(formatPerformance)) {
  const platformCount = Object.keys(platforms).length;
  if (platformCount >= 3) {
    universalWinners.push({ format: format, platforms: Object.keys(platforms), data: platforms });
  } else if (platformCount === 1 || platformCount === 2) {
    platformSpecific.push({ format: format, platforms: Object.keys(platforms), data: platforms });
  }
}

// ── Generate report ──
const today = etDate(new Date());
const report = [
  `# Cross-Platform Insights — ${appName} — ${today}`,
  '',
  `## Aggregate (last ${days} days)`,
  '',
  '| Platform | Posts | Reach | Conversions | Revenue |',
  '|----------|-------|-------|-------------|---------|',
  ...PLATFORMS.map(plat => {
    const d = allPlatformData[plat.name];
    return `| ${plat.name} | ${d.posts.length} | ${d.totalMetric.toLocaleString()} ${plat.metric} | ${d.totalConversions} | $${d.totalRevenue.toFixed(2)} |`;
  }),
  '',
  `**Total conversions:** ${PLATFORMS.reduce((s, p) => s + allPlatformData[p.name].totalConversions, 0)}`,
  `**Total revenue:** $${PLATFORMS.reduce((s, p) => s + allPlatformData[p.name].totalRevenue, 0).toFixed(2)}`,
  '',
  '## Universal Winners (3+ platforms)',
  ...(universalWinners.length > 0 ? universalWinners.map(w => {
    const details = Object.entries(w.data).map(([p, d]) => `${p}: avg ${d.avgMetric.toLocaleString()}`).join(', ');
    return `- **${w.format}** — ${details}`;
  }) : ['- Not enough cross-platform data yet']),
  '',
  '## Platform-Specific Winners',
  ...(platformSpecific.length > 0 ? platformSpecific.map(w => {
    const details = Object.entries(w.data).map(([p, d]) => `${p}: avg ${d.avgMetric.toLocaleString()}`).join(', ');
    return `- **${w.format}** — ${details}`;
  }) : ['- None identified']),
  '',
];

// Write report
const reportDir = pathsLib.reportsDir(appName);
fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${today}-${appName}.md`);
fs.writeFileSync(reportPath, report.join('\n'));

console.log(report.join('\n'));
console.log(`\n✅ Wrote ${reportPath}`);

} catch (e) {
  console.error(`\n❌ Fatal: ${e.message}`);
  process.exit(1);
}
