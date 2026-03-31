#!/usr/bin/env node
/**
 * timestamp-tracklist.js — Timestamp a DJ set tracklist using OpenAI Whisper.
 *
 * Takes a source video and a tracklist (song names + artists), samples audio
 * at regular intervals, transcribes with Whisper, and matches lyrics to known
 * songs to estimate where each track starts.
 *
 * Usage:
 *   node timestamp-tracklist.js --input source.mp4 --tracklist tracklist.json \
 *     [--interval 30] [--sample-length 10] [--output tracklist-timestamps.json]
 *
 * Input tracklist.json format:
 *   [
 *     { "track": 1, "song": "riverside", "artist": "ynho, HÜH" },
 *     { "track": 2, "song": "Miracle", "artist": "Madeon" },
 *     ...
 *   ]
 *
 * Output: same array with `startSec` added to each track.
 *
 * Requires: OPENAI_API_KEY env var, ffmpeg at ~/bin/ffmpeg
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG = process.env.FFMPEG_PATH || path.join(process.env.HOME, 'bin', 'ffmpeg');
const FFPROBE = process.env.FFPROBE_PATH || path.join(process.env.HOME, 'bin', 'ffprobe');

const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}

const input = getArg('input', null);
const tracklistFile = getArg('tracklist', null);
const interval = parseInt(getArg('interval', '15'));
const sampleLength = parseInt(getArg('sample-length', '10'));
const outputFile = getArg('output', null);

if (!input || !tracklistFile) {
  console.error('Usage: node timestamp-tracklist.js --input <video> --tracklist <json>');
  console.error('       [--interval 30] [--sample-length 10] [--output timestamps.json]');
  process.exit(1);
}

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.error('❌ OPENAI_API_KEY required');
  process.exit(1);
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getDuration() {
  return parseFloat(execSync(
    `"${FFPROBE}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${input}"`,
    { encoding: 'utf-8' }
  ).trim());
}

async function whisper(wavPath) {
  const FormData = (await import('node-fetch')).FormData || globalThis.FormData;

  // Use curl since node-fetch FormData file handling is tricky
  const result = execSync(
    `curl -s https://api.openai.com/v1/audio/transcriptions ` +
    `-H "Authorization: Bearer ${OPENAI_KEY}" ` +
    `-F file="@${wavPath}" ` +
    `-F model="whisper-1"`,
    { encoding: 'utf-8', timeout: 30000 }
  );

  try {
    return JSON.parse(result).text || '';
  } catch {
    return '';
  }
}

async function main() {
  const tracklist = JSON.parse(fs.readFileSync(tracklistFile, 'utf-8'));
  const totalDuration = getDuration();

  console.error(`🎬 Timestamping: ${path.basename(input)} (${fmt(totalDuration)})`);
  console.error(`   Tracklist: ${tracklist.length} tracks`);
  console.error(`   Sampling: every ${interval}s, ${sampleLength}s each`);
  console.error('');

  // Sample audio at intervals and transcribe
  const samples = [];
  const tmpWav = '/tmp/timestamp-sample.wav';

  for (let t = 0; t < totalDuration; t += interval) {
    execSync(
      `"${FFMPEG}" -ss ${t} -t ${sampleLength} -i "${input}" -vn -ac 1 -ar 16000 -f wav "${tmpWav}" -y 2>/dev/null`,
      { encoding: 'utf-8', timeout: 30000 }
    );

    const text = await whisper(tmpWav);
    const clean = text.trim()
      .replace(/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // strip emoji
      .trim();

    if (clean && clean.length > 5) {
      samples.push({ sec: t, text: clean });
      console.error(`  ${fmt(t)}: "${clean.substring(0, 80)}"`);
    } else {
      console.error(`  ${fmt(t)}: (instrumental/silence)`);
    }
  }

  // Clean up
  try { fs.unlinkSync(tmpWav); } catch {}

  console.error(`\n📊 ${samples.length} vocal samples found\n`);

  // Match samples to tracklist
  // For each track, find the earliest sample that contains matching keywords
  const result = tracklist.map((track, idx) => {
    // Build search terms from song name and artist
    const terms = [];

    // Extract key words from song name (skip short words)
    const songWords = track.song.toLowerCase()
      .replace(/[()]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4);
    terms.push(...songWords);

    // Artist name words
    const artistWords = track.artist.toLowerCase()
      .replace(/[.,&]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4);
    terms.push(...artistWords);

    return { ...track, _searchTerms: terms };
  });

  // Assign timestamps based on sample matching + sequential constraint
  // Track 1 always starts at 0
  result[0].startSec = 0;

  for (let i = 1; i < result.length; i++) {
    const track = result[i];
    const prevStart = result[i - 1].startSec || 0;

    // Search for matching lyrics in samples after the previous track
    let bestMatch = null;
    for (const sample of samples) {
      if (sample.sec <= prevStart) continue; // must be after previous track

      const sampleLower = sample.text.toLowerCase();
      const matchCount = track._searchTerms.filter(term =>
        sampleLower.includes(term)
      ).length;

      if (matchCount > 0 && (!bestMatch || sample.sec < bestMatch.sec)) {
        bestMatch = { ...sample, matchCount };
      }
    }

    if (bestMatch) {
      // The sample is somewhere IN the track, so the track starts slightly before
      // Use the sample time minus a small offset as the approximate start
      track.startSec = Math.max(prevStart + 15, bestMatch.sec - interval);
      console.error(`  Track ${track.track} "${track.song}": matched at ${fmt(bestMatch.sec)} → start ~${fmt(track.startSec)}`);
    } else {
      // No match — interpolate between previous and next known timestamps
      // For now, just space evenly
      const nextKnown = result.slice(i + 1).find(t => t.startSec);
      if (nextKnown) {
        const gap = nextKnown.startSec - prevStart;
        const steps = result.indexOf(nextKnown) - (i - 1);
        track.startSec = Math.round(prevStart + gap / steps);
      } else {
        // Last resort: estimate based on remaining duration
        const remainingTracks = result.length - i;
        const remainingTime = totalDuration - prevStart;
        track.startSec = Math.round(prevStart + remainingTime / (remainingTracks + 1));
      }
      console.error(`  Track ${track.track} "${track.song}": no vocal match, estimated ~${fmt(track.startSec)}`);
    }
  }

  // Clean up internal fields
  const output = result.map(({ _searchTerms, ...rest }) => rest);

  console.error('\n── Timestamped Tracklist ──\n');
  for (const t of output) {
    console.error(`  ${fmt(t.startSec)}  ${t.track}. ${t.song} — ${t.artist}`);
  }

  const json = JSON.stringify(output, null, 2);

  if (outputFile) {
    fs.writeFileSync(outputFile, json);
    console.error(`\n✅ Saved to ${outputFile}`);
  }

  // Always output to stdout for piping
  console.log(json);
}

main().catch(e => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
