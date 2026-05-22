#!/usr/bin/env node
/**
 * Prepare or create a paused Meta ad draft from a saved candidate.
 *
 * Default behavior writes a local draft intent only. Use --execute only after
 * app config has Meta IDs and the CLI is authenticated.
 */

const { parseArgs } = require('../core/helpers');
const { createDraft } = require('../core/meta-ads');

function main() {
  const { getArg, hasFlag } = parseArgs();
  const appName = getArg('app');
  const candidateId = getArg('candidate-id');
  if (!appName || !candidateId) {
    console.error('Usage: node scripts/meta-create-draft.js --app <name> --candidate-id <id> [--execute]');
    process.exit(1);
  }

  const draft = createDraft(appName, candidateId, {
    execute: hasFlag('execute'),
    command: getArg('cli-command') || undefined,
  });

  console.log(JSON.stringify(draft, null, 2));
  if (draft.status === 'cli-failed' || draft.status === 'blocked') process.exit(1);
}

main();
