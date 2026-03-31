#!/usr/bin/env node
/**
 * Test the full pipeline cycle for an app without waiting for crons.
 * Validates setup: env vars → app.json → Dropspace API → self-improve dry-run → queue depths.
 *
 * Usage: node test-pipeline.js --app myapp
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const appName = getArg('app');
if (!appName) {
  console.error('Usage: node test-pipeline.js --app <appname>');
  process.exit(1);
}

const SKILL_DIR = path.resolve(path.dirname(path.resolve(__filename || process.argv[1])), '..');
const pathsLib = require('../core/paths');

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    const result = fn();
    if (result === false) {
      console.log(`  ❌ ${label}`);
      failed++;
    } else {
      console.log(`  ✅ ${label}${result && result !== true ? ': ' + result : ''}`);
      passed++;
    }
  } catch (err) {
    console.log(`  ❌ ${label}: ${err.message}`);
    failed++;
  }
}

async function main() {
  console.log(`\n🧪 Pipeline Validation — ${appName}`);
  console.log('   Checks: env vars → app.json → API keys → platform connections → queue\n');

  // ── Step 1: Verify env vars ──
  console.log('1. Checking environment variables...');

  check('ANTHROPIC_API_KEY is set', () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('Not set. Run: source ~/dropspace/private/load-env.sh');
    }
    return `sk-ant-...${process.env.ANTHROPIC_API_KEY.slice(-4)}`;
  });

  // ── Step 2: Verify app.json ──
  console.log('\n2. Checking app.json...');

  const appConfigPath = pathsLib.appConfigPath(appName);
  let config = null;

  check('app.json exists', () => {
    if (!fs.existsSync(appConfigPath)) {
      throw new Error(`Not found at ${appConfigPath}. Run: node init-app.js --app ${appName}`);
    }
    return appConfigPath;
  });

  check('app.json is valid JSON', () => {
    config = JSON.parse(fs.readFileSync(appConfigPath, 'utf-8'));
    return true;
  });

  if (config) {
    check('name is set', () => config.name && config.name !== '' || (function(){ throw new Error('Set "name" in app.json'); })());
    check('description is set', () => config.description && config.description !== '' || (function(){ throw new Error('Set "description" in app.json — it\'s fed to the LLM for content generation'); })());
    check('apiKeyEnv is set', () => config.apiKeyEnv || (function(){ throw new Error('Set "apiKeyEnv" in app.json (e.g. DROPSPACE_API_KEY_MYAPP)'); })());
    check('pipelineType is set', () => (config.pipelineType === 'ai-generated' || config.pipelineType === 'manual') || (function(){ throw new Error('Set "pipelineType" to "ai-generated" or "manual"'); })());

    const apiKeyEnv = config.apiKeyEnv;
    check(`${apiKeyEnv} is set`, () => {
      const key = process.env[apiKeyEnv];
      if (!key) throw new Error(`Not set. Add to load-env.sh: export ${apiKeyEnv}="ds_live_..."`);
      return `ds_live_...${key.slice(-4)}`;
    });

    // ── Step 3: Verify Dropspace API key ──
    console.log('\n3. Verifying Dropspace API connection...');

    const apiKey = process.env[apiKeyEnv];
    if (apiKey && apiKey !== 'paste-key-here') {
      check('Dropspace API responds', () => {
        const result = spawnSync('curl', [
          '-s', '-o', '/dev/null', '-w', '%{http_code}',
          '-H', `Authorization: Bearer ${apiKey}`,
          'https://api.dropspace.dev/launches?page_size=1',
        ], { timeout: 10000 });
        const code = result.stdout.toString().trim();
        if (result.error) throw new Error(result.error.message);
        if (code === '200') return 'connected';
        if (code === '401') throw new Error('Invalid API key — check your key in load-env.sh');
        if (code === '403') throw new Error('Forbidden — check API key permissions');
        throw new Error(`HTTP ${code}`);
      });
    } else {
      console.log('  ⚠ Skipping API check — key is placeholder or not set');
    }

    // ── Step 4: Dry-run self-improve ──
    const enabledPlatforms = config.platforms
      ? Object.entries(config.platforms).filter(([, c]) => c.enabled !== false).map(([n]) => n)
      : [];

    if (enabledPlatforms.length > 0 && config.pipelineType === 'ai-generated') {
      const firstPlatform = enabledPlatforms[0];
      console.log(`\n4. Running self-improve dry-run (${firstPlatform})...`);
      console.log('   (This shows what the LLM will see — no posts generated)\n');

      const selfImproveScript = path.join(SKILL_DIR, 'engines', 'self-improve-engine.js');
      const result = spawnSync('node', [selfImproveScript, '--app', appName, '--platform', firstPlatform, '--days', '14', '--dry-run'], {
        timeout: 120000,
        encoding: 'utf-8',
      });

      if (result.status === 0) {
        // Print the output
        if (result.stdout) process.stdout.write(result.stdout);
        check('self-improve-engine ran successfully', () => true);
      } else {
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
        check('self-improve-engine ran successfully', () => {
          throw new Error(`Exit code ${result.status}. Check output above.`);
        });
      }
    } else if (config.pipelineType === 'manual') {
      console.log('\n4. Skipping self-improve dry-run (manual pipeline)');
      passed++;
    } else {
      console.log('\n4. Skipping self-improve dry-run (no enabled platforms)');
    }

    // ── Step 5: Show queue depths ──
    console.log('\n5. Queue depths:\n');

    for (const platform of enabledPlatforms) {
      try {
        const strategyPath = pathsLib.strategyPath(appName, platform);
        const strategy = JSON.parse(fs.readFileSync(strategyPath, 'utf-8'));
        const queue = strategy.postQueue || [];
        const readyCount = queue.filter(p => !p.scheduledAt).length;
        console.log(`   ${platform.padEnd(12)} ${queue.length} total, ${readyCount} ready to schedule`);
      } catch {
        console.log(`   ${platform.padEnd(12)} (no data yet — queue will fill after first self-improve run)`);
      }
    }
  }

  // ── Summary ──
  console.log('\n─────────────────────────────────');
  if (failed === 0) {
    console.log(`\n✅ Pipeline is configured correctly. ${passed} checks passed.`);
    if (config && config.pipelineType === 'ai-generated') {
      console.log('\nThe POSTS_NEEDED output above shows what the LLM will see during self-improve.');
    }
  } else {
    console.log(`\n⚠ ${failed} check(s) failed, ${passed} passed. Fix the issues above before setting up crons.`);
  }

  console.log('\nNext: set up crons (see setup-crons.js) or wait for the nightly run.');
  console.log(`  node ${path.join(SKILL_DIR, 'scripts', 'setup-crons.js')}\n`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
