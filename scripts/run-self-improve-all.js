#!/usr/bin/env node
/**
 * Run self-improve for all enabled platforms with retry on failure.
 *
 * Runs each platform's self-improve engine sequentially.
 * If a platform fails, retries once after all others complete.
 * Outputs POSTS_NEEDED blocks for the cron agent to generate posts.
 *
 * Usage: node run-self-improve-all.js --app dropspace [--days 14] [--dry-run]
 */

const { execSync } = require('child_process');
const path = require('path');
const { parseArgs, sendAppReport, loadJSON } = require('../core/helpers');
const paths = require('../core/paths');

const { getArg, hasFlag } = parseArgs();
const appName = getArg('app'); // If not specified, runs ALL ai-generated apps
const days = getArg('days') || '14';
const dryRun = hasFlag('dry-run');

const SCRIPT = path.join(__dirname, '..', 'engines', 'self-improve-engine.js');

// Determine which apps to run
const appsToRun = appName
  ? [{ name: appName, config: paths.loadAppConfig(appName), pipelineType: (paths.loadAppConfig(appName) || {}).pipelineType || 'ai-generated' }]
  : paths.getAllApps();

// Filter to ai-generated only — manual apps don't self-improve
const aiApps = appsToRun.filter(a => a.pipelineType === 'ai-generated');
const skippedApps = appsToRun.filter(a => a.pipelineType !== 'ai-generated');

if (skippedApps.length > 0) {
  console.log(`⏭ Skipping manual apps: ${skippedApps.map(a => a.name).join(', ')}\n`);
}

if (aiApps.length === 0) {
  console.log('No ai-generated apps to self-improve.');
  process.exit(0);
}

function runPlatform(appName, platform) {
  const cmd = `node "${SCRIPT}" --app ${appName} --platform ${platform} --days ${days}${dryRun ? ' --dry-run' : ''}`;
  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 480000, // 8 min per platform (first platform fetches shared data, cache serves rest)
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Print output (includes POSTS_NEEDED blocks that the agent needs to see)
    process.stdout.write(output);
    return { ok: true, output };
  } catch (e) {
    const stderr = (e.stderr || '').trim();
    const stdout = (e.stdout || '').trim();
    // Still print stdout — may contain partial results
    if (stdout) process.stdout.write(stdout + '\n');
    const errMsg = stderr || e.message;
    console.error(`\n❌ ${platform} failed: ${errMsg.substring(0, 300)}\n`);
    return { ok: false, error: errMsg.substring(0, 300) };
  }
}

let anyFailed = false;

(async () => {
for (const app of aiApps) {
  const targetApp = app.name;
  const enabledPlatforms = paths.getEnabledPlatforms(targetApp);
  if (enabledPlatforms.length === 0) {
    console.log(`⚠️ No enabled platforms for ${targetApp}, skipping\n`);
    continue;
  }

  console.log(`🔄 Self-improve all: ${targetApp} [${app.pipelineType}] (${enabledPlatforms.join(', ')})\n`);

  const results = { success: [], failed: [], retried: [] };

  // First pass
  for (const platform of enabledPlatforms) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`▶ ${targetApp}/${platform}`);
    const result = runPlatform(targetApp, platform);
    if (result.ok) {
      results.success.push(platform);
    } else {
      results.failed.push({ platform, error: result.error });
    }
  }

  // Retry failed platforms once
  if (results.failed.length > 0) {
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`🔁 Retrying ${results.failed.length} failed platform(s): ${results.failed.map(f => f.platform).join(', ')}\n`);

    const stillFailed = [];
    for (const { platform, error: firstError } of results.failed) {
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`▶ ${targetApp}/${platform} (retry)`);
      const result = runPlatform(targetApp, platform);
      if (result.ok) {
        results.retried.push(platform);
      } else {
        stillFailed.push({ platform, firstError, retryError: result.error });
      }
    }
    results.failed = stillFailed;
  }

  // Summary per app
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 Self-improve Summary for ${targetApp}`);
  console.log(`  ✅ Success: ${results.success.length} (${results.success.join(', ') || 'none'})`);
  if (results.retried.length > 0) {
    console.log(`  🔁 Retried: ${results.retried.length} (${results.retried.join(', ')})`);
  }
  if (results.failed.length > 0) {
    console.log(`  ❌ Failed:  ${results.failed.length}`);
    for (const f of results.failed) {
      console.log(`     ${f.platform}: ${f.retryError}`);
    }
    anyFailed = true;
  }
  console.log('');

  // ── Slack delivery: queue status per platform ──
  const slackLines = [`_🧠 Self-Improve — ${targetApp} — ${new Date().toISOString().split('T')[0]}_`];
  for (const plat of enabledPlatforms) {
    try {
      const strat = loadJSON(paths.strategyPath(targetApp, plat), {});
      const qLen = (strat.postQueue || []).length;
      const appCfg = paths.loadAppConfig(targetApp);
      const minQ = appCfg?.minQueue || 7;
      const status = results.failed.some(f => f.platform === plat) ? '❌' : '✅';
      slackLines.push(`${status} ${plat}: ${qLen} queued (min ${minQ})`);
    } catch { slackLines.push(`⚠️ ${plat}: unknown`); }
  }
  if (results.failed.length > 0) {
    slackLines.push('');
    slackLines.push('*Failed:*');
    for (const f of results.failed) slackLines.push(`• ${f.platform}: ${f.retryError.substring(0, 100)}`);
  }
  slackLines.push(`\n_Agent will generate posts for platforms with POSTS_NEEDED above._`);
  try {
    await sendAppReport(targetApp, slackLines.join('\n'));
  } catch (e) {
    console.error(`⚠️ Slack report failed: ${e.message}`);
  }
}

if (anyFailed) process.exitCode = 1;
})();
