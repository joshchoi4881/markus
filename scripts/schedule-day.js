#!/usr/bin/env node
/**
 * Schedule a full day's posts across all platforms for an app.
 *
 * Reads app.json for enabled platforms and posting times, then calls
 * the appropriate create-post engine for each slot.
 *
 * Usage:
 *   node schedule-day.js --app dropspace [--date 2026-02-27] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { loadJSON, parseArgs, saveJSON, resolveApiKey, isWeekday, toISOSchedule, resolveEngine, TIMEOUTS } = require('../core/helpers');
const paths = require('../core/paths');
const { checkScheduledExists } = require('../core/api');
const { PLATFORMS: PLATFORM_DEFS } = require('../core/platforms');
const { getArg, hasFlag } = parseArgs();

const appName = getArg('app') || 'dropspace';
const targetDate = getArg('date') || (() => {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    .toISOString().split('T')[0];
})();
const dryRun = hasFlag('dry-run');

// ── Idempotency tracking ──
// Prevents duplicate scheduling if schedule-day runs twice on the same day
const scheduledTodayPath = path.join(paths.appRoot(appName), `scheduled-${targetDate}.json`);
const scheduledToday = loadJSON(scheduledTodayPath, { slots: {} });

function slotKey(platform, time) {
  return `${platform}:${time}`;
}

function markScheduled(platform, time, launchId) {
  scheduledToday.slots[slotKey(platform, time)] = {
    launchId: launchId || 'unknown',
    scheduledAt: new Date().toISOString(),
  };
  if (!dryRun) saveJSON(scheduledTodayPath, scheduledToday);
}

function isAlreadyScheduled(platform, time) {
  return !!scheduledToday.slots[slotKey(platform, time)];
}

async function main() {
  console.log(`📅 Scheduling ${appName} posts for ${targetDate}${dryRun ? ' (DRY RUN)' : ''}\n`);

  const appConfig = paths.loadAppConfig(appName);
  if (!appConfig) {
    console.error(`❌ No app.json found for ${appName} at ${paths.appConfigPath(appName)}`);
    process.exit(1);
  }

  const results = { scheduled: 0, skipped: 0, failed: 0, errors: [] };

  for (const [platform, platAppConfig] of Object.entries(appConfig.platforms || {})) {
    if (platAppConfig.enabled === false) {
      console.log(`  ⏭ ${platform}: disabled`);
      continue;
    }

    const platDef = PLATFORM_DEFS[platform];
    if (!platDef) {
      console.log(`  ⚠️ ${platform}: unknown platform, skipping`);
      continue;
    }

    const strategyFile = paths.strategyPath(appName, platform);
    if (!fs.existsSync(strategyFile)) {
      console.log(`  ⏭ ${platform}: no strategy.json, skipping`);
      results.skipped++;
      continue;
    }

    const strategy = loadJSON(strategyFile, {});
    const postingTimes = platAppConfig.postingTimes || [];
    const queue = strategy.postQueue || [];
    const weekdaysOnly = platAppConfig.weekdaysOnly || false;
    const skipDays = appConfig.skipDays || [];

    if (weekdaysOnly && !isWeekday(targetDate)) {
      console.log(`  ⏭ ${platform}: weekday-only, skipping (${targetDate} is weekend)`);
      results.skipped++;
      continue;
    }

    // App-level skip days (0=Sunday, 6=Saturday)
    const dayOfWeek = new Date(targetDate + 'T12:00:00Z').getUTCDay();
    if (skipDays.includes(dayOfWeek)) {
      const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      console.log(`  ⏭ ${platform}: skip day (${dayNames[dayOfWeek]})`);
      results.skipped++;
      continue;
    }

    if (queue.length === 0) {
      console.log(`  ⚠️ ${platform}: post queue empty, skipping`);
      results.skipped++;
      continue;
    }

    const now = new Date();
    const minTime = new Date(now.getTime() + 16 * 60 * 1000);

    let retryCount = 0;
    for (let i = 0; i < postingTimes.length && i < queue.length; i++) {
      const time = postingTimes[i];
      const post = queue[i];
      // Use non-jittered time for "already past" check and dedup
      const baseISO = toISOSchedule(targetDate, time, { jitter: false });
      // Jittered time (±30 min) for the actual scheduled_date
      const scheduledISO = toISOSchedule(targetDate, time);
      const baseDate_dt = new Date(baseISO);

      if (baseDate_dt < minTime) {
        console.log(`  ⏭ ${platform} ${time}: already past, skipping`);
        results.skipped++;
        continue;
      }

      if (isAlreadyScheduled(platform, time)) {
        const prev = scheduledToday.slots[slotKey(platform, time)];
        console.log(`  ⏭ ${platform} ${time}: already scheduled (launch ${prev.launchId}), skipping`);
        results.skipped++;
        continue;
      }

      const hookText = post.text || post;

      if (dryRun) {
        console.log(`  🏃 ${platform} ${time}: "${hookText.substring(0, 60)}..." [DRY RUN]`);
        continue;
      }

      // Server-side dedup: use non-jittered base time with wider tolerance to account for jitter
      const existing = await checkScheduledExists(
        resolveApiKey(appName),
        platform,
        baseISO,
        20 // 20 min tolerance covers ±15 min jitter window
      );
      if (existing) {
        console.log(`  ⏭ ${platform} ${time}: launch already exists on server (${existing.id}), skipping`);
        markScheduled(platform, time, existing.id);
        results.skipped++;
        continue;
      }

      console.log(`  🚀 ${platform} ${time}: "${hookText.substring(0, 60)}..."`);

      // ── Pre-configured posts with existing launchId: just schedule via API ──
      if (post.launchId) {
        try {
          const apiKey = resolveApiKey(appName);
          const scheduleRes = await fetch(`https://api.dropspace.dev/launches/${post.launchId}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ scheduled_date: scheduledISO }),
          });
          if (scheduleRes.ok) {
            console.log(`  ✅ ${platform} ${time}: scheduled existing launch ${post.launchId}`);
            markScheduled(platform, time, post.launchId);
            results.scheduled++;

            // Dequeue
            queue.splice(i, 1);
            i--; // adjust since we removed an item
            saveJSON(strategyFile, { ...strategy, postQueue: queue });

            // Record in posts.json
            const postsFile = paths.postsPath(appName, platform);
            const postsData = loadJSON(postsFile, { posts: [] });
            postsData.posts.push({
              ...post,
              scheduledDate: scheduledISO,
              scheduledAt: new Date().toISOString(),
            });
            saveJSON(postsFile, postsData);
          } else {
            const errText = await scheduleRes.text();
            console.error(`  ❌ ${platform} ${time}: API error scheduling launch ${post.launchId}: ${errText.substring(0, 200)}`);
            results.errors.push(`${platform} ${time}: API ${scheduleRes.status}`);
            results.failed++;
          }
        } catch (e) {
          console.error(`  ❌ ${platform} ${time}: ${e.message}`);
          results.errors.push(`${platform} ${time}: ${e.message}`);
          results.failed++;
        }
        continue;
      }

      // ── AI-generated posts: run engine to create + schedule ──
      // Pick engine based on NEXT queue entry (index 0 on disk — engines dequeue after each run)
      const engineScript = resolveEngine(appName, platform, platAppConfig, 0);

      const cmd = `node "${engineScript}" --app ${appName} --platform ${platform} --schedule "${scheduledISO}" --next`;

      try {
        // Video gen formats (ugc-reaction, ugc-talking) need up to 10 min
        const isVideoFormat = (() => {
          try {
            const strat = JSON.parse(fs.readFileSync(paths.strategyPath(appName, platform), 'utf-8'));
            const nextFormat = strat.postQueue?.[0]?.format || '';
            return ['ugc-reaction', 'ugc-talking'].includes(nextFormat);
          } catch { return false; }
        })();
        const execTimeout = isVideoFormat ? TIMEOUTS.videoEngineExec : TIMEOUTS.engineExec;

        const output = execSync(cmd, {
          encoding: 'utf-8',
          timeout: execTimeout,
          env: process.env,
          maxBuffer: 10 * 1024 * 1024,
        });

        // Extract launch ID from output if available
        const launchIdMatch = output.match(/Launch[:\s]+([a-f0-9-]{36})/i) || output.match(/id[:\s"]+([a-f0-9-]{36})/i);
        const launchId = launchIdMatch ? launchIdMatch[1] : null;

        if (output.includes('Launch created') || output.includes('SCHEDULED')) {
          console.log(`  ✅ ${platform} ${time}: scheduled for ${scheduledISO}`);
          markScheduled(platform, time, launchId);
          results.scheduled++;
          retryCount = 0;
        } else if (output.includes('already exists') || output.includes('Skipping to avoid duplicate')) {
          console.log(`  ⏭ ${platform} ${time}: already scheduled (idempotency check)`);
          markScheduled(platform, time, launchId || 'existing');
          results.skipped++;
        } else if (!output.trim()) {
          console.error(`  ❌ ${platform} ${time}: engine produced no output (script may not have a CLI entrypoint)`);
          results.errors.push(`${platform} ${time}: engine produced no output`);
          results.failed++;
        } else {
          console.error(`  ❌ ${platform} ${time}: unexpected output (no 'Launch created' or 'SCHEDULED' marker)`);
          console.error(`     Output: ${output.trim().split('\n').slice(-3).join(' | ').substring(0, 200)}`);
          results.errors.push(`${platform} ${time}: unexpected engine output`);
          results.failed++;
        }

        for (const line of output.split('\n')) {
          if (line.includes('⚠️') || line.includes('❌')) {
            console.log(`     ${line.trim()}`);
          }
        }
      } catch (e) {
        const stderr = e.stderr || '';
        const stdout = e.stdout || '';
        const allOutput = (stdout + '\n' + stderr).trim();

        // Quality gate failure — the bad post was already dequeued, retry with next post
        if (allOutput.includes('Quality gate FAILED') && retryCount < 2) {
          retryCount++;
          console.log(`  🔄 ${platform} ${time}: quality gate rejected post, trying next in queue (attempt ${retryCount + 1}/3)...`);
          i--; // retry this time slot
          continue;
        }

        // Prefer stdout error lines (actual fatal errors) over stderr (may be just warnings)
        const stdoutErrors = stdout.split('\n').filter(l => l.includes('❌') || l.includes('ERROR') || l.includes('Fatal')).join('; ').trim();
        const errMsg = stdoutErrors || stderr.split('\n').filter(l => l.includes('❌') || l.includes('ERROR') || l.includes('Fatal')).join('; ').trim() || e.message;
        console.error(`  ❌ ${platform} ${time}: ${errMsg.substring(0, 300)}`);
        results.errors.push(`${platform} ${time}: ${errMsg.substring(0, 300)}`);
        results.failed++;
      }
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📊 Schedule Summary for ${targetDate}`);
  console.log(`  ✅ Scheduled: ${results.scheduled}`);
  console.log(`  ⏭ Skipped:   ${results.skipped}`);
  console.log(`  ❌ Failed:    ${results.failed}`);
  if (results.errors.length > 0) {
    console.log(`\n⚠️ Errors:`);
    for (const e of results.errors) console.log(`  - ${e}`);
  }
  console.log('');

  // Clean up old scheduled-*.json files (keep last 3 days)
  try {
    const appRoot = paths.appRoot(appName);
    const files = fs.readdirSync(appRoot).filter(f => f.startsWith('scheduled-') && f.endsWith('.json'));
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    for (const f of files) {
      const dateStr = f.replace('scheduled-', '').replace('.json', '');
      if (dateStr < cutoff) {
        fs.unlinkSync(path.join(appRoot, f));
      }
    }
  } catch { /* non-critical */ }

  if (results.failed > 0) process.exitCode = 1;
}

main().catch(e => {
  console.error(`\n❌ Fatal: ${e.message}`);
  process.exit(1);
});
