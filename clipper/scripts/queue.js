#!/usr/bin/env node
/**
 * Queue a video clip for distribution via Dropspace.
 * Creates a launch with video media and pipes to the shared pipeline.
 *
 * Usage:
 *   node queue.js --app myapp --platform tiktok \
 *     --video /path/to/clip.mp4 --text "Hook text" --caption "Caption" \
 *     [--artist "..."] [--event "..."] [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}
function hasFlag(name) { return args.includes(`--${name}`); }

const appName = getArg('app');
const platform = getArg('platform') || 'tiktok';
const videoPath = getArg('video');
const text = getArg('text');
const caption = getArg('caption') || '';
const artist = getArg('artist') || '';
const event = getArg('event') || '';
const dryRun = hasFlag('dry-run');

if (!videoPath || !text) {
  console.error('Usage: node queue.js --app <name> --platform <platform> --video <path> --text "..." --caption "..."');
  process.exit(1);
}

if (!fs.existsSync(videoPath)) {
  console.error(`❌ Video file not found: ${videoPath}`);
  process.exit(1);
}

// Build the post entry for the strategy queue
const post = {
  text,
  caption: caption || text,
  format: 'video',
  videoPath: path.resolve(videoPath),
  source: 'clipper',
  addedAt: new Date().toISOString().split('T')[0],
  metadata: {
    artist,
    event,
  },
};

if (dryRun) {
  console.log('🏃 Dry run — would queue:');
  console.log(JSON.stringify(post, null, 2));
  process.exit(0);
}

// Pipe to add-posts.js
const { execSync } = require('child_process');
const addPostsScript = path.join(__dirname, '..', 'add-posts.js');

const input = JSON.stringify({ posts: [post], notes: `Queued clip: "${text}" (${artist} @ ${event})` });

try {
  const output = execSync(
    `echo '${input.replace(/'/g, "'\\''")}' | node "${addPostsScript}" --app ${appName} --platform ${platform}`,
    { encoding: 'utf-8', env: process.env }
  );
  console.log(output);
} catch (e) {
  console.error(`❌ Queue failed: ${e.stderr || e.message}`);
  process.exit(1);
}
