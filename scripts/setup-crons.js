#!/usr/bin/env node
/**
 * Outputs the OpenClaw cron configuration for the content pipeline.
 * Run after setup.js to see what crons to create.
 *
 * Usage: node setup-crons.js [--timezone America/New_York]
 */

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}

const path = require('path');
const timezone = getArg('timezone', 'America/New_York');
const SKILL_DIR = path.resolve(path.dirname(__filename), '..');

const CRONS = [
  {
    name: 'midnight',
    schedule: '0 0 * * *',
    timezone,
    timeout: 900,
    description: 'Refresh analytics, clean up old assets, send nightly reports',
    delivery: { mode: 'none' },
    payload: `Midnight monitoring run — ALL apps.

source ${SKILL_DIR}/load-env.sh
node ${SKILL_DIR}/scripts/refresh-tracking.js --all
node ${SKILL_DIR}/scripts/cleanup-posts.js --all

Then for each app in ~/dropspace/apps/ that has an app.json:
  Read pipelineType from app.json.
  Run: node ${SKILL_DIR}/scripts/midnight-report.js --app <name> --days 7
  Send the report to the app's notification channel (read notifications.channel and notifications.target from app.json, use the message tool).

When formatting the report, include BOTH traffic sources as separate sections:
- GA4 sources (report.ga4): users, sessions, pageviews, top sources by user count
- PostHog sources (report.posthog): uniqueUsers, totalPageviews, topSources (referrer breakdown sorted by count)

Example:
  Traffic (7d)
  • GA4: X users, Y sessions, Z pageviews
  • PostHog: X unique users, Y pageviews
  Top sources (GA4): ...
  Top sources (PostHog): ...

Your final response is the condensed summary across all apps.`,
  },
  {
    name: 'x-research',
    schedule: '30 0 * * *',
    timezone,
    timeout: 300,
    description: 'Scan X/Twitter for trending hooks and competitor signals (optional)',
    delivery: { mode: 'none' },
    payload: `X Research — scan X for trending angles.

source ${SKILL_DIR}/load-env.sh

For each app in ~/dropspace/apps/ that has xResearch config in app.json:
  node ${SKILL_DIR}/scripts/run-x-research.js --app <name>
  Send report to app's notification channel.`,
    note: 'Requires Bird CLI or X API bearer token. Skip if you don\'t use X research.',
  },
  {
    name: 'self-improve-all',
    schedule: '0 1 * * *',
    timezone,
    timeout: 3600,
    description: 'Analyze performance and generate new posts for all apps',
    delivery: { mode: 'none' },
    payload: `Self-improve run for all ai-generated apps.

Read ${SKILL_DIR}/docs/CRON_RULES.md first.

source ${SKILL_DIR}/load-env.sh
node ${SKILL_DIR}/scripts/run-self-improve-all.js --days 14

The output contains POSTS_NEEDED blocks for each platform. For each one:

1. If slotsAvailable > 0: generate complete post blueprints following the format rules in POSTS_NEEDED.
   Visual posts need: text, slideTexts, caption, format, plus sceneAnchor+slideMoods (story-slideshow) or slidePrompts (for other visual formats).
   Text posts need: text, postBody, format.
   Video posts need: text, videoPrompt, caption, format.

2. FACT-CHECK BEFORE SAVING: For each generated post, verify any factual claims:
   - If a post references a real event, person, or news story: use web_search and/or bird search to confirm the details are accurate. If you can't verify it or the details are wrong, rewrite to remove the unverified claims.
   - If a post claims a competitor lacks a capability: web_search to verify. If they do have it, rewrite to focus on what this product does instead.
   - If a post cites specific numbers: confirm they come from the POSTS_NEEDED analytics data, not from your training data.
   - For trending topics or recent drama: bird search is often more current than web_search for verifying what actually happened on X/Twitter.
   Do NOT skip this step. Posting misinformation is worse than posting nothing.

3. Save posts and strategy notes:
   echo '{"posts":[...], "notes":"your analysis", "crossNotes":"insights for other platforms"}' | node ${SKILL_DIR}/scripts/add-posts.js --app <name> --platform <platform>

4. Even if slotsAvailable is 0, still analyze performance and save notes with empty posts array.

After all platforms: verify every queue meets minQueue (from app.json). Generate more if needed.
Send per-app reports to each app's notification channel.`,
  },
  {
    name: 'schedule-day',
    schedule: '0 2 * * *',
    timezone,
    timeout: 2400,
    description: 'Schedule all queued posts for today via Dropspace',
    delivery: { mode: 'none' },
    payload: `Schedule all posts for today.

source ${SKILL_DIR}/load-env.sh

For each app in ~/dropspace/apps/ with app.json:
  Read pipelineType.
  If ai-generated: node ${SKILL_DIR}/scripts/schedule-day.js --app <name>
  If manual: node ${SKILL_DIR}/scripts/daily-schedule-report.js --app <name>
  Send results to app's notification channel.

Never create launches directly via curl. Only run schedule-day.js.`,
  },
];

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║           Content Pipeline — Cron Configuration             ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');
console.log(`Timezone: ${timezone}`);
console.log('Create these crons in OpenClaw (UI → Crons → Add, or via CLI).\n');

for (const cron of CRONS) {
  console.log('━'.repeat(66));
  console.log(`\nCRON: ${cron.name}`);
  if (cron.note) console.log(`NOTE: ${cron.note}`);
  console.log(`Schedule:    ${cron.schedule} @ ${cron.timezone}`);
  console.log(`Timeout:     ${cron.timeout}s`);
  console.log(`Description: ${cron.description}`);
  console.log(`Delivery:    mode: none (agent handles routing)`);
  console.log(`\nPayload (copy-paste this entire block):\n`);
  console.log('---');
  console.log(cron.payload);
  console.log('---\n');
}

console.log('━'.repeat(66));
console.log('\n⚠  Failure alerts (optional)');
console.log('Add failureAlert to any cron to get notified if it fails:');
console.log('  failureAlert: { channel: "telegram", to: "YOUR_CHAT_ID" }');
console.log('  failureAlert: { channel: "slack", to: "C0CHANNEL_ID" }\n');

console.log('Done. Set up these crons, then run:');
console.log(`  node ${SKILL_DIR}/scripts/test-pipeline.js --app <yourapp>`);
console.log('');
console.log('📅 Day 1 note: The pipeline runs overnight (self-improve → schedule-day).');
console.log('   Posts generated tonight won\'t be scheduled until tomorrow\'s schedule-day run.');
console.log('   To post immediately, run schedule-day manually after self-improve completes:');
console.log(`     node ${SKILL_DIR}/scripts/schedule-day.js --app <yourapp>`);
