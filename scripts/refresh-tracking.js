#!/usr/bin/env node
/**
 * Refresh TRACKING.md for any app — pulls analytics from Dropspace API
 * and writes a performance report at ~/dropspace/apps/<app>/TRACKING.md.
 *
 * Usage:
 *   node refresh-tracking.js --app <APP>
 *   node refresh-tracking.js --app <APP>
 *   node refresh-tracking.js --all          # refresh all apps
 *
 * Output:
 *   ~/dropspace/apps/<app>/TRACKING.md   — human-readable report
 *   ~/dropspace/apps/<app>/tracking.json — machine-readable (consumed by self-improve-engine)
 */

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME;
const pathsLib = require('../core/paths');
const APPS_DIR = pathsLib.DATA_ROOT;

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}
const hasFlag = (name) => args.includes(`--${name}`);

const { dropspaceRequest } = require('../core/api');

function loadAppConfig(name) {
  return pathsLib.loadAppConfig(name);
}

function getAllApps() {
  const skip = new Set(['cache', 'node_modules']);
  return fs.readdirSync(APPS_DIR)
    .filter(d => !skip.has(d) && !d.startsWith('.') && fs.existsSync(path.join(APPS_DIR, d, 'app.json')));
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
}

async function refreshApp(appName) {
  const appConfig = loadAppConfig(appName);
  if (!appConfig) { console.error(`  ⚠️ No app.json for ${appName}`); return; }

  const apiKey = process.env[appConfig.apiKeyEnv];
  if (!apiKey) { console.error(`  ⚠️ Missing ${appConfig.apiKeyEnv} for ${appName}`); return; }

  console.error(`\n📊 ${appName}...`);

  // Fetch all launches
  let allLaunches = [];
  let page = 1;
  while (true) {
    const data = await dropspaceRequest('GET', `/launches?limit=50&page=${page}`, null, apiKey);
    allLaunches.push(...(data.data || []));
    if (allLaunches.length >= (data.pagination?.total || 0)) break;
    page++;
  }

  const launches = allLaunches.filter(l => ['completed', 'partial'].includes(l.status));
  console.error(`  ${launches.length} completed launches (${allLaunches.length} total)`);

  const jsonPath = path.join(APPS_DIR, appName, 'tracking.json');

  if (launches.length === 0) {
    const md = `# TRACKING.md — ${appConfig.name || appName}\n\n*Last updated: ${new Date().toISOString().slice(0, 19)} UTC*\n\nNo completed launches yet.\n`;
    fs.writeFileSync(path.join(APPS_DIR, appName, 'TRACKING.md'), md);
    fs.writeFileSync(jsonPath, JSON.stringify({ updatedAt: new Date().toISOString(), launches: [], analyticsById: {} }, null, 2));
    return;
  }

  // Fetch analytics in batches (100 IDs per request instead of 1 call per launch)
  const rows = [];
  const analyticsById = {};
  const launchIds = launches.map(l => l.id);
  for (let i = 0; i < launchIds.length; i += 100) {
    const batch = launchIds.slice(i, i + 100);
    try {
      const batchResult = await dropspaceRequest('GET', `/launches/analytics?ids=${batch.join(',')}`, null, apiKey);
      const items = batchResult.data || batchResult || [];
      for (const ad of (Array.isArray(items) ? items : [])) {
        if (ad.launch_id) analyticsById[ad.launch_id] = ad;
      }
      // Batch endpoint returns cached data — if any completed launch has null metrics,
      // hit the individual endpoint to trigger a fresh fetch from the platform
      for (const id of batch) {
        const ad = analyticsById[id];
        if (!ad) continue;
        const hasNullMetrics = (ad.platforms || []).some(p => p.status === 'success' && !p.metrics);
        if (hasNullMetrics) {
          try {
            const single = await dropspaceRequest('GET', `/launches/${id}/analytics`, null, apiKey);
            if (single.data) analyticsById[id] = single.data;
          } catch { /* skip — batch data is still usable */ }
        }
      }
    } catch (e) {
      console.error(`  ⚠️ Batch analytics failed (offset ${i}): ${e.message}`);
      // Fallback: fetch individually for this batch
      for (const id of batch) {
        try {
          const single = await dropspaceRequest('GET', `/launches/${id}/analytics`, null, apiKey);
          if (single.data) analyticsById[id] = single.data;
        } catch { /* skip */ }
      }
    }
  }

  // Build rows from analytics data
  for (const launch of launches) {
    const ad = analyticsById[launch.id];
    if (!ad) continue;

    for (const platform of (ad.platforms || [])) {
      const m = platform.metrics || {};
      const impressions = m.impressions ?? m.views ?? null;
      const likes = m.likes ?? null;
      const comments = m.comments ?? m.replies ?? null;
      const shares = m.shares ?? m.retweets ?? null;
      const clicks = m.urlClicks ?? m.clicks ?? null;

      const engNumerator = (likes || 0) + (comments || 0) + (shares || 0);
      const engDenominator = impressions || null;

      rows.push({
        date: formatDate(launch.scheduled_date || platform.posted_at),
        dateSortKey: new Date(launch.scheduled_date || platform.posted_at || 0).getTime(),
        title: (ad.launch_name || launch.title || '(untitled)').slice(0, 50),
        platform: platform.platform,
        status: platform.status,
        postUrl: platform.post_url || '',
        impressions,
        likes,
        comments,
        shares,
        clicks,
          engRate: engDenominator ? (engNumerator / engDenominator * 100).toFixed(1) + '%' : '—',
          isThread: m.isThread || false,
          threadLength: m.threadLength || null,
        });
      }
  }

  rows.sort((a, b) => a.dateSortKey - b.dateSortKey);

  // Backfill postUrl + deletion info into posts.json for each platform
  const { extractDeletionInfo } = require('../core/helpers');
  const platformNames = appConfig
    ? Object.entries(appConfig.platforms).filter(([_, c]) => c.enabled !== false).map(([n]) => n)
    : [];
  for (const plat of platformNames) {
    const postsFile = pathsLib.postsPath(appName, plat);
    if (!fs.existsSync(postsFile)) continue;
    try {
      const postsData = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
      let changed = false;
      for (const post of (postsData.posts || [])) {
        if (!post.launchId) continue;
        const ad = analyticsById[post.launchId];
        if (!ad) continue;
        for (const pData of (ad.platforms || [])) {
          if (pData.platform !== plat) continue;
          // Backfill postUrl
          if (!post.postUrl && pData.post_url) {
            post.postUrl = pData.post_url;
            changed = true;
          }
          // Backfill deletion info
          const delInfo = extractDeletionInfo(pData);
          if (delInfo && !post.isDeleted) {
            post.isDeleted = true;
            post.deletedDetectedAt = delInfo.deletedDetectedAt;
            post.deletionReason = delInfo.deletionReason;
            changed = true;
          }
        }
      }
      if (changed) {
        fs.writeFileSync(postsFile, JSON.stringify(postsData, null, 2));
        console.error(`  📝 Backfilled posts.json for ${plat}`);
      }
    } catch (e) {
      console.error(`  ⚠️ Failed to backfill ${plat}/posts.json: ${e.message}`);
    }
  }

  // Totals
  const sum = (field) => rows.reduce((s, r) => s + (typeof r[field] === 'number' ? r[field] : 0), 0);
  const totalImpr = sum('impressions');
  const totalLikes = sum('likes');
  const totalComments = sum('comments');
  const totalShares = sum('shares');
  const avgEng = totalImpr > 0
    ? ((totalLikes + totalComments + totalShares) / totalImpr * 100).toFixed(1) + '%' : '—';

  // Per-platform
  const byPlatform = {};
  for (const r of rows) {
    if (!byPlatform[r.platform]) byPlatform[r.platform] = { posts: 0, impressions: 0, likes: 0, comments: 0, shares: 0 };
    const p = byPlatform[r.platform];
    p.posts++;
    p.impressions += typeof r.impressions === 'number' ? r.impressions : 0;
    p.likes += typeof r.likes === 'number' ? r.likes : 0;
    p.comments += typeof r.comments === 'number' ? r.comments : 0;
    p.shares += typeof r.shares === 'number' ? r.shares : 0;
  }

  // Write
  let md = `# TRACKING.md — ${appConfig.name || appName}\n\n`;
  md += `*Last updated: ${new Date().toISOString().slice(0, 19)} UTC*\n\n`;

  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Posts tracked | ${rows.length} |\n`;
  md += `| Impressions | ${totalImpr.toLocaleString()} |\n`;
  md += `| Likes | ${totalLikes.toLocaleString()} |\n`;
  md += `| Comments/Replies | ${totalComments.toLocaleString()} |\n`;
  md += `| Shares/Retweets | ${totalShares.toLocaleString()} |\n`;
  md += `| Engagement rate | ${avgEng} |\n\n`;

  md += `## By Platform\n\n`;
  md += `| Platform | Posts | Impressions | Likes | Comments | Shares | Eng% |\n`;
  md += `|----------|-------|-------------|-------|----------|--------|------|\n`;
  for (const [plat, s] of Object.entries(byPlatform).sort((a, b) => b[1].impressions - a[1].impressions)) {
    const er = s.impressions > 0 ? ((s.likes + s.comments + s.shares) / s.impressions * 100).toFixed(1) + '%' : '—';
    md += `| ${plat} | ${s.posts} | ${s.impressions.toLocaleString()} | ${s.likes} | ${s.comments} | ${s.shares} | ${er} |\n`;
  }
  md += '\n';

  // Top performers (by engagement rate, min 50 impressions)
  const withEng = rows.filter(r => typeof r.impressions === 'number' && r.impressions >= 50);
  if (withEng.length > 0) {
    withEng.sort((a, b) => {
      const aEng = ((a.likes || 0) + (a.comments || 0) + (a.shares || 0)) / a.impressions;
      const bEng = ((b.likes || 0) + (b.comments || 0) + (b.shares || 0)) / b.impressions;
      return bEng - aEng;
    });

    md += `## Top Performers\n\n`;
    md += `| Date | Platform | Title | Impr | Eng% |\n`;
    md += `|------|----------|-------|------|------|\n`;
    for (const r of withEng.slice(0, 5)) {
      md += `| ${r.date} | ${r.platform} | ${r.title} | ${r.impressions} | ${r.engRate} |\n`;
    }
    md += '\n';
  }

  // Flag possibly manual posts (0 impressions or deleted after 48h — likely reposted manually outside Dropspace)
  // Common case: TikTok DJ set clips get copyright-flagged when posted via API, so the user may delete
  // the API post and manually reposts from the app (where copyright checks are less aggressive).
  const now = Date.now();
  const possiblyManual = rows.filter(r => {
    const age = now - r.dateSortKey;
    const isZeroMetrics = r.impressions === 0 || r.impressions === null;
    const isDeleted = r.status === 'deleted' || r.postStatus === 'deleted';
    return age > 48 * 60 * 60 * 1000 && (isZeroMetrics || isDeleted);
  });
  if (possiblyManual.length > 0) {
    md += `## ⚠️ Possibly Manual Posts\n\n`;
    md += `*These completed launches have 0 impressions or were deleted after 48h. The user may have reposted manually (e.g., TikTok copyright flags on DJ sets, tagging people). Metrics for these live on the manual repost, not here.*\n\n`;
    for (const r of possiblyManual) {
      md += `- **${r.title}** (${r.platform}, ${r.date})\n`;
    }
    md += '\n';
  }

  // All posts
  md += `## All Posts\n\n`;
  md += `| Date | Platform | Title | Impr | Likes | Comments | Shares | Eng% | Link |\n`;
  md += `|------|----------|-------|------|-------|----------|--------|------|------|\n`;
  for (const r of rows) {
    const link = r.postUrl ? `[→](${r.postUrl})` : '—';
    const threadNote = r.isThread ? ` (${r.threadLength}t)` : '';
    const impr = r.impressions !== null ? r.impressions : '—';
    const likes = r.likes !== null ? r.likes : '—';
    const comments = r.comments !== null ? r.comments : '—';
    const shares = r.shares !== null ? r.shares : '—';
    md += `| ${r.date} | ${r.platform}${threadNote} | ${r.title} | ${impr} | ${likes} | ${comments} | ${shares} | ${r.engRate} | ${link} |\n`;
  }

  fs.writeFileSync(path.join(APPS_DIR, appName, 'TRACKING.md'), md);

  // Write machine-readable JSON (consumed by self-improve-engine)
  const launchSummaries = allLaunches.map(l => ({
    id: l.id,
    title: l.title || l.name || null,
    status: l.status,
    scheduled_date: l.scheduled_date || null,
    platforms: l.platforms || [],
  }));
  fs.writeFileSync(jsonPath, JSON.stringify({
    updatedAt: new Date().toISOString(),
    launches: launchSummaries,
    analyticsById,
  }, null, 2));

  console.error(`  ✅ ${rows.length} posts, ${totalImpr.toLocaleString()} impressions, ${avgEng} engagement`);
}

async function main() {
  const appName = getArg('app', null);
  const all = hasFlag('all');

  if (!appName && !all) {
    console.error('Usage: node refresh-tracking.js --app <name>  |  --all');
    process.exit(1);
  }

  const apps = all ? getAllApps() : [appName];
  console.error(`📊 Refreshing tracking for ${apps.length} app(s)...`);

  for (const app of apps) {
    try {
      await refreshApp(app);
    } catch (e) {
      console.error(`  ❌ ${app}: ${e.message}`);
    }
  }

  console.error('\nDone.');
}

main().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
