#!/usr/bin/env node
/**
 * Queue a slideshow post from pre-sourced images.
 *
 * Takes image paths + text and creates a queue entry compatible with
 * create-visual-post-engine.js (which will skip AI generation when
 * imagePaths is present in the queue entry).
 *
 * Usage:
 *   node slideshow-queue.js --app myapp --platform instagram \
 *     --hook "Summer Sessions Highlights 🎤" \
 *     --caption "Live music moments from NYC #myevent" \
 *     --texts "Slide 1 text,Slide 2 text,..." \
 *     --images /path/slide1.jpg,/path/slide2.jpg,...
 *
 *   # Or pipe images from slideshow.js:
 *   node slideshow.js --folder <id> --output /tmp/slides | \
 *     node slideshow-queue.js --app myapp --platform instagram \
 *       --hook "..." --caption "..." --texts "..."
 */

const fs = require('fs');
const path = require('path');

function getArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

const appName = getArg('app');
const platform = getArg('platform');
const hook = getArg('hook');
const caption = getArg('caption') || hook;
const textsRaw = getArg('texts');
const imagesRaw = getArg('images');

if (!appName || !platform || !hook) {
  console.error('Usage: node slideshow-queue.js --app <name> --platform <platform> --hook "..." [--caption "..."] [--texts "t1,t2,..."] [--images "p1,p2,..."]');
  process.exit(1);
}

// Parse image paths — from --images flag or stdin
let imagePaths;
if (imagesRaw) {
  imagePaths = imagesRaw.split(',').map(p => path.resolve(p.trim()));
} else {
  // Try reading from stdin (piped from slideshow.js)
  const stdin = fs.readFileSync(0, 'utf-8').trim();
  const lines = stdin.split('\n');
  // Last line should be JSON array of paths
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (Array.isArray(parsed)) { imagePaths = parsed; break; }
    } catch {}
  }
  if (!imagePaths) {
    console.error('❌ No image paths found. Use --images or pipe from slideshow.js');
    process.exit(1);
  }
}

// Parse slide texts
let slideTexts;
if (textsRaw) {
  slideTexts = textsRaw.split(',').map(t => t.trim());
} else {
  // Default: no text overlays (empty strings = engine skips overlay)
  slideTexts = imagePaths.map(() => '');
}

// Pad/trim to match image count
while (slideTexts.length < imagePaths.length) slideTexts.push('');
slideTexts = slideTexts.slice(0, imagePaths.length);

// Verify images exist
for (const p of imagePaths) {
  if (!fs.existsSync(p)) {
    console.error(`❌ Image not found: ${p}`);
    process.exit(1);
  }
}

// Build queue entry
const queueEntry = {
  posts: [{
    text: hook,
    caption,
    slideTexts,
    imagePaths,
    imageSource: 'drive',
    format: 'slideshow',
  }],
  notes: `Slideshow from ${imagePaths.length} Drive images`,
};

// Pipe to add-posts.js
const addPostsPath = path.join(process.env.HOME, '.openclaw/skills/shared/add-posts.js');
const { execSync } = require('child_process');

console.log(`📋 Queuing slideshow post: "${hook}"`);
console.log(`   ${imagePaths.length} images, ${slideTexts.filter(t => t).length} text overlays`);

try {
  const result = execSync(
    `node "${addPostsPath}" --app ${appName} --platform ${platform}`,
    { input: JSON.stringify(queueEntry), encoding: 'utf-8' }
  );
  console.log(result);
} catch (e) {
  console.error(`❌ Failed to queue: ${e.message}`);
  process.exit(1);
}
