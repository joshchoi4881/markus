#!/usr/bin/env node
/**
 * Song identification for DJ set videos.
 *
 * Extracts short audio samples at intervals throughout a video,
 * runs each through Shazam to identify the track playing.
 * Outputs a timestamped tracklist.
 *
 * Usage:
 *   node identify-songs.js --input /path/to/video.mp4 [--interval 30] [--sample-length 15]
 *
 * Output: JSON tracklist to stdout
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Shazam } = require('node-shazam');

const FFMPEG = process.env.FFMPEG_PATH || path.join(process.env.HOME, 'bin', 'ffmpeg');
const CACHE_DIR = path.join(process.env.HOME, '.cache', 'songid');

// ── Args ──
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}

const inputPath = getArg('input', null);
const intervalSec = parseInt(getArg('interval', '30'), 10);  // sample every N seconds
const sampleLength = parseInt(getArg('sample-length', '15'), 10);  // each sample is N seconds
const outputFile = getArg('output', null);

if (!inputPath) {
  console.error('Usage: node identify-songs.js --input /path/to/video.mp4 [--interval 30] [--sample-length 15] [--output tracklist.json]');
  process.exit(1);
}

// ── Helpers ──

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getVideoDuration(file) {
  const out = execSync(
    `${FFMPEG} -i "${file}" 2>&1 | grep "Duration" | head -1`,
    { encoding: 'utf-8', timeout: 30000 }
  ).trim();
  const match = out.match(/Duration:\s*(\d+):(\d+):(\d+)/);
  if (!match) throw new Error('Could not determine video duration');
  return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
}

function extractAudioSample(inputFile, startSec, durationSec, outFile) {
  execSync(
    `${FFMPEG} -y -ss ${startSec} -i "${inputFile}" -t ${durationSec} -vn -ar 44100 -ac 1 -f wav "${outFile}" 2>/dev/null`,
    { timeout: 30000 }
  );
}

function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Main ──

async function main() {
  ensureDir(CACHE_DIR);

  console.error(`🎵 Song Identifier — sampling every ${intervalSec}s, ${sampleLength}s per sample\n`);
  console.error(`  Input: ${inputPath}`);

  const duration = getVideoDuration(inputPath);
  console.error(`  Duration: ${formatTime(duration)}\n`);

  const shazam = new Shazam();
  const tracklist = [];
  let lastSong = null;
  let sampleCount = 0;

  for (let t = 0; t < duration - sampleLength; t += intervalSec) {
    sampleCount++;
    const sampleFile = path.join(CACHE_DIR, `sample-${t}.wav`);

    console.error(`  ⏱️  ${formatTime(t)} — extracting sample ${sampleCount}...`);

    try {
      extractAudioSample(inputPath, t, sampleLength, sampleFile);

      const result = await shazam.fromFilePath(sampleFile, false, 'en-US');

      // Clean up sample immediately
      try { fs.unlinkSync(sampleFile); } catch {}

      const track = result?.track;
      if (track) {
        const title = track.title || 'Unknown';
        const artist = track.subtitle || 'Unknown';
        const songKey = `${title}|||${artist}`;

        if (songKey !== lastSong) {
          console.error(`    🎶 ${title} — ${artist}`);
          tracklist.push({
            timestamp: formatTime(t),
            timestampSec: t,
            title,
            artist,
            shazamUrl: track.url || null,
            coverArt: track.images?.coverart || null,
          });
          lastSong = songKey;
        } else {
          console.error(`    ↩️  (still: ${title})`);
        }
      } else {
        console.error(`    ❓ No match`);
        // If we can't ID and it's been a while, mark as unknown
        if (lastSong !== 'UNKNOWN') {
          tracklist.push({
            timestamp: formatTime(t),
            timestampSec: t,
            title: null,
            artist: null,
            note: 'unidentified segment',
          });
          lastSong = 'UNKNOWN';
        }
      }
    } catch (e) {
      console.error(`    ⚠️ Error: ${e.message}`);
      try { fs.unlinkSync(sampleFile); } catch {}
    }

    // Rate limit — don't hammer Shazam
    await new Promise(r => setTimeout(r, 2000));
  }

  console.error(`\n📋 Found ${tracklist.filter(t => t.title).length} identified tracks from ${sampleCount} samples\n`);

  const output = {
    source: path.basename(inputPath),
    duration: formatTime(duration),
    durationSec: duration,
    sampleInterval: intervalSec,
    identifiedAt: new Date().toISOString(),
    tracks: tracklist,
  };

  if (outputFile) {
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
    console.error(`  Saved to ${outputFile}`);
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch(e => {
  console.error(`❌ Fatal: ${e.message}`);
  process.exit(1);
});
