#!/usr/bin/env node
/**
 * Daily Schedule Report for manual-pipeline apps.
 *
 * Queries the Dropspace API for today's scheduled/completed/failed launches
 * and outputs a summary suitable for Slack delivery.
 *
 * Usage:
 *   node daily-schedule-report.js --app <APP> [--date 2026-03-14]
 *
 * Output: JSON with { app, date, scheduled, completed, failed, summary }
 */

const { resolveApiKey, parseArgs } = require('../core/helpers');
const { fetchScheduledCounts } = require('../core/api');
const paths = require('../core/paths');

const { getArg } = parseArgs();
const appName = getArg('app');
if (!appName) {
  console.error('❌ --app required');
  process.exit(1);
}

const targetDate = getArg('date') || (() => {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    .toISOString().split('T')[0];
})();

const DROPSPACE_URL = 'https://api.dropspace.dev';

async function fetchLaunches(apiKey, page = 1, pageSize = 100) {
  const res = await fetch(`${DROPSPACE_URL}/launches?page=${page}&page_size=${pageSize}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Dropspace API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const appConfig = paths.loadAppConfig(appName);
  if (!appConfig) {
    console.error(`❌ No app.json for ${appName}`);
    process.exit(1);
  }

  const apiKey = resolveApiKey(appName);
  if (!apiKey) {
    console.error(`❌ No API key for ${appName}`);
    process.exit(1);
  }

  // Fetch recent launches (last 2 pages should cover today)
  const data = await fetchLaunches(apiKey, 1, 100);
  const launches = Array.isArray(data) ? data : (data.data || []);

  // Filter to today's date (ET)
  const todayLaunches = launches.filter(l => {
    const sd = l.scheduled_date || l.scheduledDate;
    if (!sd) return false;
    // Convert to ET date string
    const etDate = new Date(sd).toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etDateStr = new Date(etDate).toISOString().split('T')[0];
    return etDateStr === targetDate;
  });

  // Also include launches created today that are already completed/failed (published immediately)
  const todayPublished = launches.filter(l => {
    if (todayLaunches.includes(l)) return false;
    const created = l.created_at || l.createdAt;
    if (!created) return false;
    const etDate = new Date(created).toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etDateStr = new Date(etDate).toISOString().split('T')[0];
    return etDateStr === targetDate && ['completed', 'partial', 'failed'].includes(l.status);
  });

  const allToday = [...todayLaunches, ...todayPublished];

  // Categorize
  const scheduled = allToday.filter(l => l.status === 'scheduled');
  const completed = allToday.filter(l => l.status === 'completed');
  const partial = allToday.filter(l => l.status === 'partial');
  const failed = allToday.filter(l => l.status === 'failed');
  const running = allToday.filter(l => l.status === 'running');
  const draft = allToday.filter(l => l.status === 'draft');

  // Build summary
  const lines = [];
  lines.push(`📅 ${appConfig.name || appName} — ${targetDate} Schedule`);
  lines.push('');

  if (allToday.length === 0) {
    lines.push('No posts scheduled for today.');
  } else {
    if (scheduled.length > 0) {
      lines.push(`⏰ Scheduled (${scheduled.length}):`);
      for (const l of scheduled) {
        const sd = l.scheduled_date || l.scheduledDate;
        const timeET = new Date(sd).toLocaleString('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        const platforms = (l.platforms || []).join(', ') || 'unknown';
        const title = (l.title || l.product_description || '').substring(0, 60);
        lines.push(`  • ${timeET} → ${platforms} — "${title}"`);
      }
      lines.push('');
    }

    if (running.length > 0) {
      lines.push(`🔄 Publishing now (${running.length}):`);
      for (const l of running) {
        const platforms = (l.platforms || []).join(', ') || 'unknown';
        const title = (l.title || l.product_description || '').substring(0, 60);
        lines.push(`  • ${platforms} — "${title}"`);
      }
      lines.push('');
    }

    if (completed.length > 0) {
      lines.push(`✅ Published (${completed.length}):`);
      for (const l of completed) {
        const platforms = (l.platforms || []).join(', ') || 'unknown';
        const title = (l.title || l.product_description || '').substring(0, 60);
        lines.push(`  • ${platforms} — "${title}"`);
      }
      lines.push('');
    }

    if (partial.length > 0) {
      lines.push(`⚠️ Partial (${partial.length}):`);
      for (const l of partial) {
        const platforms = (l.platforms || []).join(', ') || 'unknown';
        const title = (l.title || l.product_description || '').substring(0, 60);
        lines.push(`  • ${platforms} — "${title}"`);
      }
      lines.push('');
    }

    if (failed.length > 0) {
      lines.push(`❌ Failed (${failed.length}):`);
      for (const l of failed) {
        const platforms = (l.platforms || []).join(', ') || 'unknown';
        const title = (l.title || l.product_description || '').substring(0, 60);
        lines.push(`  • ${platforms} — "${title}"`);
      }
      lines.push('');
    }

    if (draft.length > 0) {
      lines.push(`📝 Drafts (${draft.length}):`);
      for (const l of draft) {
        const platforms = (l.platforms || []).join(', ') || 'unknown';
        const title = (l.title || l.product_description || '').substring(0, 60);
        lines.push(`  • ${platforms} — "${title}"`);
      }
      lines.push('');
    }
  }

  // Queue depth: Dropspace scheduled count for manual apps, local postQueue for ai-generated
  let scheduledCounts = {};
  try {
    scheduledCounts = await fetchScheduledCounts(apiKey);
  } catch { /* fallback below */ }

  const queueInfo = [];
  for (const [platform, platConfig] of Object.entries(appConfig.platforms || {})) {
    if (platConfig.enabled === false) continue;
    if (scheduledCounts[platform] > 0) {
      queueInfo.push(`${platform}: ${scheduledCounts[platform]} scheduled`);
    } else {
      // Fall back to local strategy.json
      const stratPath = paths.strategyPath(appName, platform);
      try {
        const strategy = JSON.parse(require('fs').readFileSync(stratPath, 'utf-8'));
        const qLen = (strategy.postQueue || []).length;
        queueInfo.push(`${platform}: ${qLen}`);
      } catch {
        queueInfo.push(`${platform}: no queue`);
      }
    }
  }

  if (queueInfo.length > 0) {
    lines.push(`📦 Queue: ${queueInfo.join(' · ')}`);
  }

  const summary = lines.join('\n');
  console.log(summary);

  // Also output as JSON for programmatic use
  const result = {
    app: appName,
    date: targetDate,
    total: allToday.length,
    scheduled: scheduled.length,
    completed: completed.length,
    partial: partial.length,
    failed: failed.length,
    running: running.length,
    draft: draft.length,
    summary,
  };

  // Write to stdout marker for cron consumption
  console.log('\n---JSON---');
  console.log(JSON.stringify(result));
}

main().catch(e => {
  console.error(`❌ Fatal: ${e.message}`);
  process.exit(1);
});
