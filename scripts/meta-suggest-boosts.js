#!/usr/bin/env node
/**
 * Suggest Meta boost candidates from organic post history.
 *
 * Usage:
 *   node scripts/meta-suggest-boosts.js --app dropspace [--include-disabled] [--json] [--notify]
 */

const fs = require('fs');
const path = require('path');
const { parseArgs, sendAppReport } = require('../core/helpers');
const paths = require('../core/paths');
const { findBoostCandidates, saveCandidates } = require('../core/meta-ads');

async function main() {
  const { getArg, hasFlag } = parseArgs();
  const appName = getArg('app');
  if (!appName) {
    console.error('Usage: node scripts/meta-suggest-boosts.js --app <name> [--include-disabled] [--json] [--notify]');
    process.exit(1);
  }

  const platforms = getArg('platforms') ? getArg('platforms').split(',').map(s => s.trim()).filter(Boolean) : null;
  const result = findBoostCandidates(appName, {
    includeDisabled: hasFlag('include-disabled'),
    sinceHours: getArg('since-hours') ? Number(getArg('since-hours')) : null,
    minEngagementRate: getArg('min-engagement-rate') ? Number(getArg('min-engagement-rate')) : null,
    platforms,
  });

  const saved = saveCandidates(appName, result);
  const reportLines = [];
  reportLines.push('Meta boost candidates: ' + appName);
  reportLines.push('');
  reportLines.push(result.summary);
  if (!result.enabled) reportLines.push('Status: disabled in app config');
  reportLines.push('Saved: ' + path.relative(paths.appRoot(appName), require('../core/meta-ads').paths.candidatesPath(appName)));
  reportLines.push('');

  for (const candidate of result.candidates.slice(0, 10)) {
    reportLines.push('- ' + candidate.id + ' · ' + candidate.platform + ' · ' + (candidate.metrics.engagementRate * 100).toFixed(2) + '% · ' + candidate.postUrl);
  }
  if (result.candidates.length === 0) reportLines.push('No eligible posts found.');

  const report = reportLines.join('\n');
  const reportsDir = paths.reportsDir(appName);
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, 'meta-boost-candidates.md'), report);

  if (hasFlag('notify')) await sendAppReport(appName, report);
  if (hasFlag('json')) console.log(JSON.stringify({ ...result, saved }, null, 2));
  else console.log(report);
}

main().catch(err => {
  console.error('Meta boost suggestion failed:', err.message);
  process.exit(1);
});
