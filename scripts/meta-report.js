#!/usr/bin/env node
/**
 * Report local Meta paid-distribution state for an app.
 *
 * Usage:
 *   node scripts/meta-report.js --app dropspace [--json] [--notify]
 */

const fs = require('fs');
const path = require('path');
const { parseArgs, sendAppReport } = require('../core/helpers');
const paths = require('../core/paths');
const { report } = require('../core/meta-ads');

async function main() {
  const { getArg, hasFlag } = parseArgs();
  const appName = getArg('app');
  if (!appName) {
    console.error('Usage: node scripts/meta-report.js --app <name> [--json] [--notify]');
    process.exit(1);
  }

  const data = report(appName);
  const reportsDir = paths.reportsDir(appName);
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, 'meta-paid-distribution.md'), data.markdown);

  if (hasFlag('notify')) await sendAppReport(appName, data.markdown);
  if (hasFlag('json')) console.log(JSON.stringify(data, null, 2));
  else console.log(data.markdown);
}

main().catch(err => {
  console.error('Meta report failed:', err.message);
  process.exit(1);
});
