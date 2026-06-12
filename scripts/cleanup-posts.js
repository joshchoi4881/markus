#!/usr/bin/env node
/**
 * Cleanup old post asset directories to prevent disk bloat.
 *
 * Deletes entire post directories older than --days (default 7).
 * All post data is preserved in posts.json — local dirs are just build artifacts.
 *
 * Usage: node cleanup-posts.js --app dropspace [--days 7] [--dry-run]
 *        node cleanup-posts.js --all [--days 7] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('../core/helpers');
const paths = require('../core/paths');
const { getAllPlatforms } = require('../core/platforms');

const { getArg, hasFlag } = parseArgs();
const allApps = hasFlag('all');
const appName = getArg('app') || (allApps ? null : 'dropspace');
const maxDays = parseInt(getArg('days') || '7');
const dryRun = hasFlag('dry-run');

const cutoff = new Date(Date.now() - maxDays * 24 * 60 * 60 * 1000);

function cleanApp(app) {
  let appCleaned = 0;
  let appBytes = 0;

  for (const platform of getAllPlatforms()) {
    const postsDir = paths.postsAssetsRoot(app, platform);
    if (!fs.existsSync(postsDir)) continue;

    const entries = fs.readdirSync(postsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const dirDate = entry.name.substring(0, 10);
      if (!dirDate.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

      const dirDateObj = new Date(dirDate + 'T12:00:00Z');
      if (dirDateObj >= cutoff) continue;

      const dirPath = path.join(postsDir, entry.name);
      let dirBytes = 0;

      const files = fs.readdirSync(dirPath);
      for (const f of files) {
        try { dirBytes += fs.statSync(path.join(dirPath, f)).size; } catch {}
      }

      if (!dryRun) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }

      appCleaned++;
      appBytes += dirBytes;
      console.log(`  ${dryRun ? '🏃' : '🗑️'} ${app}/${platform}/${entry.name}: ${files.length} files (${(dirBytes / 1024 / 1024).toFixed(1)}MB)`);
    }
  }

  return { cleaned: appCleaned, bytes: appBytes };
}

const apps = allApps ? paths.getAllApps().map(a => a.name) : [appName];
let totalCleaned = 0;
let totalBytes = 0;

for (const app of apps) {
  const { cleaned, bytes } = cleanApp(app);
  totalCleaned += cleaned;
  totalBytes += bytes;
}

console.log(`\n${dryRun ? '🏃 Dry run:' : '✅'} ${totalCleaned} dirs cleaned (${(totalBytes / 1024 / 1024).toFixed(1)}MB)${dryRun ? ' would be' : ''} freed`);
