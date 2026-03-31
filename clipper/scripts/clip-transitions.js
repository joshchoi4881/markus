#!/usr/bin/env node
/**
 * clip-transitions.js — Clip DJ set transitions + peak moments.
 *
 * Two-phase clipping:
 *   Phase 1: Transition clips — one per track boundary from timestamped tracklist
 *   Phase 2: Peak clips — energy peaks from analyze.js, skipping overlaps with phase 1
 *
 * Requires a tracklist JSON with timestamps (from the timestamping step).
 *
 * Usage:
 *   node clip-transitions.js --input source.mp4 --tracklist tracklist-timestamps.json \
 *     --output-dir ./clips [--duration 30] [--extra-peaks 5] [--min-gap 45] [--dry-run]
 *
 * Tracklist JSON format:
 *   [
 *     { "track": 1, "song": "riverside", "artist": "ynho, HÜH", "startSec": 0 },
 *     { "track": 2, "song": "Miracle", "artist": "Madeon", "startSec": 240 },
 *     ...
 *   ]
 *
 * Output: clips named clip01.mp4, clip02.mp4, ... and a clips-manifest.json
 *   Phase 1 clips (transitions): clip01 through clipN (N = number of transitions)
 *   Phase 2 clips (peaks): clipN+1 onwards
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
function hasFlag(name) { return args.includes(`--${name}`); }

const input = getArg('input', null);
const tracklistFile = getArg('tracklist', null);
const outputDir = getArg('output-dir', './clips');
const clipDuration = parseInt(getArg('duration', '30'));
const extraPeaks = parseInt(getArg('extra-peaks', '5'));
const minGap = parseInt(getArg('min-gap', '45'));
const cropMode = getArg('crop', 'center');
const dryRun = hasFlag('dry-run');
const skipRefine = hasFlag('skip-refine');

if (!input || !tracklistFile) {
  console.error('Usage: node clip-transitions.js --input <video> --tracklist <json>');
  console.error('       --output-dir <dir> [--duration 30] [--extra-peaks 5] [--min-gap 45]');
  console.error('       [--crop center|left|right] [--dry-run] [--skip-refine]');
  process.exit(1);
}

const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

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

function cutClip(startSec, duration, outputPath) {
  // Get source dimensions for crop
  const infoRaw = execSync(
    `"${FFPROBE}" -v error -select_streams v:0 -show_entries stream=width,height -of json "${input}"`,
    { encoding: 'utf-8' }
  );
  const stream = JSON.parse(infoRaw).streams[0];
  const srcW = stream.width, srcH = stream.height;

  // Crop to 9:16
  const targetRatio = 9 / 16;
  const srcRatio = srcW / srcH;
  let cropW, cropH, cropX, cropY;

  if (srcRatio > targetRatio) {
    cropH = srcH;
    cropW = Math.round(srcH * targetRatio);
    cropY = 0;
    cropX = cropMode === 'left' ? 0 : cropMode === 'right' ? srcW - cropW : Math.round((srcW - cropW) / 2);
  } else {
    cropW = srcW;
    cropH = Math.round(srcW / targetRatio);
    cropX = 0;
    cropY = Math.round((srcH - cropH) / 2);
  }

  const vf = `crop=${cropW}:${cropH}:${cropX}:${cropY},scale=1080:1920:flags=lanczos`;

  const cmd = [
    `"${FFMPEG}"`,
    `-ss ${startSec}`,
    `-i "${input}"`,
    `-t ${duration}`,
    `-vf "${vf}"`,
    `-c:v libx264 -preset medium -crf 23`,
    `-c:a aac -b:a 128k -ac 2 -ar 44100`,
    `-movflags +faststart`,
    `-y "${outputPath}"`,
  ].join(' ');

  try {
    execSync(cmd, { encoding: 'utf-8', timeout: 300000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    if (!fs.existsSync(outputPath)) {
      throw new Error(`FFmpeg failed: ${e.stderr?.slice(-200) || e.message}`);
    }
  }
}

/**
 * Refine a transition point using Whisper + energy analysis.
 *
 * 1. Whisper sweep: samples audio every 5s in a wide window around the estimate,
 *    looking for lyrics from the incoming track (song B).
 * 2. Energy fallback: if no lyrics match, runs analyze.js scoped to just the
 *    search window (not the full video) to find the biggest spectral shift.
 *
 * @param {number} estimatedSec - Approximate transition time from tracklist
 * @param {object} trackA - Outgoing track { song, artist, startSec }
 * @param {object} trackB - Incoming track { song, artist, startSec }
 * @param {number} totalDuration - Total video duration
 * @param {object} [opts] - Optional overrides
 * @param {number} [opts.prevTransition] - Previous confirmed transition time (for window sizing)
 * @param {number} [opts.nextEstimate] - Next track's estimated start (for window sizing)
 * @returns {number} Refined transition time in seconds
 */
function refineTransition(estimatedSec, trackA, trackB, totalDuration, opts = {}) {
  if (skipRefine || !OPENAI_KEY) return estimatedSec;

  // Dynamic search window: use the gap between adjacent transitions as bounds.
  // With coarse timestamps (30s sampling), the estimate can be off by up to 60s.
  // Window: max(60s, half the gap to previous/next) before, same after.
  const prevBound = opts.prevTransition != null ? opts.prevTransition : Math.max(0, estimatedSec - 90);
  const nextBound = opts.nextEstimate != null ? opts.nextEstimate : estimatedSec + 90;
  const halfGapBefore = Math.floor((estimatedSec - prevBound) / 2);
  const halfGapAfter = Math.floor((nextBound - estimatedSec) / 2);
  const windowBefore = Math.max(60, halfGapBefore);
  const windowAfter = Math.max(30, halfGapAfter);

  const windowStart = Math.max(0, estimatedSec - windowBefore);
  const windowEnd = Math.min(totalDuration, estimatedSec + windowAfter);
  const step = 5;
  const sampleLen = 5;

  // Build search terms from track B's song name and artist
  const songLower = trackB.song.toLowerCase().replace(/[()]/g, ' ').trim();
  const artistLower = trackB.artist.toLowerCase().replace(/[.,&]/g, ' ').trim();

  const songWords = songLower.split(/\s+/).filter(w => w.length >= 4);
  const artistWords = artistLower.split(/\s+/).filter(w => w.length >= 4);

  // Multi-word phrases are more specific
  const phrases = [];
  if (songWords.length >= 2) phrases.push(songWords.slice(0, 3).join(' '));

  const allTerms = [...new Set([...phrases, ...songWords, ...artistWords])];

  console.log(`    🔍 Refining transition (${fmt(windowStart)}-${fmt(windowEnd)}, looking for: ${allTerms.join(', ')})...`);

  let firstMatchSec = null;

  for (let t = windowStart; t <= windowEnd; t += step) {
    try {
      execSync(
        `"${FFMPEG}" -ss ${t} -t ${sampleLen} -i "${input}" -vn -ac 1 -ar 16000 -f wav /tmp/_refine_sample.wav -y 2>/dev/null`,
        { encoding: 'utf-8', timeout: 15000 }
      );

      const result = execSync(
        `curl -s https://api.openai.com/v1/audio/transcriptions ` +
        `-H "Authorization: Bearer ${OPENAI_KEY}" ` +
        `-F file="@/tmp/_refine_sample.wav" ` +
        `-F model="whisper-1"`,
        { encoding: 'utf-8', timeout: 30000 }
      );

      const text = JSON.parse(result).text || '';
      const textLower = text.toLowerCase();

      const matched = allTerms.filter(term => textLower.includes(term));

      if (matched.length > 0 && !firstMatchSec) {
        firstMatchSec = t;
        console.log(`    📍 Found "${matched.join(', ')}" at ${fmt(t)} ("${text.substring(0, 60)}...")`);
        break;
      }
    } catch {
      // Whisper failure — skip
    }
  }

  try { fs.unlinkSync('/tmp/_refine_sample.wav'); } catch {}

  if (firstMatchSec !== null) {
    console.log(`    📍 Refined: ${fmt(estimatedSec)} → ${fmt(firstMatchSec)}`);
    return firstMatchSec;
  }

  // Fallback: energy analysis SCOPED to the search window only.
  // Extract just the window segment, then find the biggest spectral shift in it.
  console.log(`    ⚠️ No lyric match — trying scoped energy analysis (${fmt(windowStart)}-${fmt(windowEnd)})...`);
  try {
    const segmentPath = '/tmp/_refine_segment.mp4';
    const segmentDuration = windowEnd - windowStart;
    execSync(
      `"${FFMPEG}" -ss ${windowStart} -t ${segmentDuration} -i "${input}" -c copy -y "${segmentPath}" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 60000 }
    );

    const analyzeScript = path.join(__dirname, 'analyze.js');
    // analyze.js logs to stderr, JSON to stdout. Capture stdout only.
    const raw = execSync(
      `node "${analyzeScript}" --input "${segmentPath}" --top 3 --min-gap 10 --clip-duration ${clipDuration} 2>/dev/null`,
      { encoding: 'utf-8', timeout: 300000, maxBuffer: 10 * 1024 * 1024 }
    );

    try { fs.unlinkSync(segmentPath); } catch {}

    let candidates;
    // Try parsing full output first (it should be a clean JSON array)
    try {
      candidates = JSON.parse(raw.trim());
    } catch {
      // Fallback: search for JSON array in output lines
      for (const line of raw.trim().split('\n').reverse()) {
        try { const parsed = JSON.parse(line); if (Array.isArray(parsed)) { candidates = parsed; break; } } catch {}
      }
    }

    if (Array.isArray(candidates) && candidates.length > 0) {
      // Offset candidates back to source video time
      const adjusted = candidates.map(c => ({
        ...c,
        peakSec: c.peakSec + windowStart,
        startSec: c.startSec + windowStart,
        endSec: c.endSec + windowStart,
      }));

      // Pick the candidate with the highest spectral flux score (most likely transition)
      const best = adjusted.reduce((a, b) =>
        (b.signals?.flux || 0) > (a.signals?.flux || 0) ? b : a
      );

      console.log(`    📍 Energy-refined: ${fmt(estimatedSec)} → ${fmt(best.peakSec)} (flux:${best.signals?.flux}, score:${best.score})`);
      return best.peakSec;
    }
  } catch (e) {
    console.log(`    ⚠️ Energy analysis failed: ${e.message?.substring(0, 80)}`);
  }

  console.log(`    ⚠️ Could not refine — using estimate ${fmt(estimatedSec)}`);
  return estimatedSec;
}

// Check if two clip ranges overlap significantly
function hasOverlap(startA, endA, startB, endB, threshold) {
  const overlapStart = Math.max(startA, startB);
  const overlapEnd = Math.min(endA, endB);
  const overlap = Math.max(0, overlapEnd - overlapStart);
  return overlap >= threshold;
}

async function main() {
  const tracklist = JSON.parse(fs.readFileSync(tracklistFile, 'utf-8'));
  const totalDuration = getDuration();

  console.log(`🎬 Clipping: ${path.basename(input)} (${fmt(totalDuration)})`);
  console.log(`   Tracklist: ${tracklist.length} tracks`);
  console.log(`   Clip duration: ${clipDuration}s`);
  console.log('');

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const clips = [];
  let clipNum = 0;

  // ── Phase 1: Transition clips ──────────────────────────────────
  console.log('── Phase 1: Transition Clips ──');
  console.log('');

  for (let i = 0; i < tracklist.length - 1; i++) {
    const trackA = tracklist[i];
    const trackB = tracklist[i + 1];

    // Transition point = start of track B (refined via Whisper if available)
    const estimatedTransition = trackB.startSec;
    const prevTransition = i > 0 ? (clips[i - 1]?.transitionSec ?? tracklist[i].startSec) : trackA.startSec;
    const nextEstimate = i < tracklist.length - 2 ? tracklist[i + 2].startSec : totalDuration;
    const transitionSec = refineTransition(estimatedTransition, trackA, trackB, totalDuration, { prevTransition, nextEstimate });

    // Center the clip on the transition: half before (end of A), half after (start of B)
    const half = Math.floor(clipDuration / 2);
    let startSec = Math.max(0, transitionSec - half);
    if (startSec + clipDuration > totalDuration) {
      startSec = Math.max(0, Math.floor(totalDuration) - clipDuration);
    }

    // No overlap allowed between transition clips.
    // If this clip overlaps with the previous transition, shift it forward
    // so it starts exactly where the previous one ends.
    if (clips.length > 0) {
      const prevClip = clips[clips.length - 1];
      if (startSec < prevClip.endSec) {
        const shift = prevClip.endSec - startSec;
        startSec = prevClip.endSec;
        console.log(`    ⚠️ Shifted +${shift}s to avoid overlap with clip ${String(prevClip.num).padStart(2, '0')}`);
        if (startSec + clipDuration > totalDuration) {
          startSec = Math.max(0, Math.floor(totalDuration) - clipDuration);
        }
      }
    }

    const endSec = startSec + clipDuration;

    clipNum++;
    const clipName = `clip${String(clipNum).padStart(2, '0')}.mp4`;
    const clipPath = path.join(outputDir, clipName);

    const clipInfo = {
      num: clipNum,
      phase: 'transition',
      file: clipName,
      startSec,
      endSec,
      transitionSec,
      songA: { track: trackA.track, song: trackA.song, artist: trackA.artist },
      songB: { track: trackB.track, song: trackB.song, artist: trackB.artist },
      caption: `${trackA.song.toLowerCase()} by ${trackA.artist.toLowerCase()} into ${trackB.song.toLowerCase()} by ${trackB.artist.toLowerCase()}`,
    };

    console.log(`  ${clipName}: ${fmt(startSec)}-${fmt(endSec)} | ${trackA.song} → ${trackB.song}`);

    if (!dryRun) {
      cutClip(startSec, clipDuration, clipPath);
      const sizeMB = (fs.statSync(clipPath).size / 1048576).toFixed(1);
      console.log(`    ✅ ${sizeMB}MB`);
    }

    clips.push(clipInfo);
  }

  const transitionCount = clips.length;
  console.log(`\n  ${transitionCount} transition clips\n`);

  // ── Phase 2: Peak clips ────────────────────────────────────────
  if (extraPeaks > 0) {
    console.log('── Phase 2: Peak Clips (via analyze.js) ──');
    console.log('');

    // Run analyze.js to get peak candidates
    const analyzeScript = path.join(__dirname, 'analyze.js');
    const analysisRaw = execSync(
      `node "${analyzeScript}" --input "${input}" --top ${extraPeaks + transitionCount} --min-gap ${minGap} --clip-duration ${clipDuration}`,
      { encoding: 'utf-8', timeout: 600000, maxBuffer: 10 * 1024 * 1024 }
    );

    // analyze.js outputs JSON to stdout, logs to stderr
    const analysisLines = analysisRaw.trim().split('\n');
    let candidates;
    for (let i = analysisLines.length - 1; i >= 0; i--) {
      try {
        candidates = JSON.parse(analysisLines[i]);
        break;
      } catch { /* not JSON, skip */ }
    }

    if (!candidates || !Array.isArray(candidates)) {
      // Try parsing the whole output
      try {
        candidates = JSON.parse(analysisRaw);
      } catch {
        console.error('  ⚠️ Could not parse analyze.js output, skipping peak clips');
        candidates = [];
      }
    }

    let peakCount = 0;
    const overlapThreshold = clipDuration * 0.4; // 40% overlap = skip

    for (const candidate of candidates) {
      if (peakCount >= extraPeaks) break;

      const startSec = candidate.startSec;
      const endSec = candidate.endSec || startSec + clipDuration;

      // Peaks may overlap with transition clips, but NOT with other peak clips
      const peakClips = clips.filter(c => c.phase === 'peak');
      const overlaps = peakClips.some(c =>
        hasOverlap(startSec, endSec, c.startSec, c.endSec, overlapThreshold)
      );

      if (overlaps) {
        console.log(`  ⏭ ${fmt(startSec)}-${fmt(endSec)} skipped (overlaps existing clip)`);
        continue;
      }

      clipNum++;
      peakCount++;
      const clipName = `clip${String(clipNum).padStart(2, '0')}.mp4`;
      const clipPath = path.join(outputDir, clipName);

      // Figure out which song(s) this peak falls in
      let songA = null, songB = null;
      for (let i = 0; i < tracklist.length; i++) {
        const t = tracklist[i];
        const nextStart = i < tracklist.length - 1 ? tracklist[i + 1].startSec : totalDuration;
        if (startSec >= t.startSec && startSec < nextStart) {
          songA = t;
          // If clip extends past this track, it spans a transition
          if (endSec > nextStart && i < tracklist.length - 1) {
            songB = tracklist[i + 1];
          }
          break;
        }
      }

      const clipInfo = {
        num: clipNum,
        phase: 'peak',
        file: clipName,
        startSec,
        endSec,
        peakSec: candidate.peakSec,
        score: candidate.score,
        reasons: candidate.reasons,
        songA: songA ? { track: songA.track, song: songA.song, artist: songA.artist } : null,
        songB: songB ? { track: songB.track, song: songB.song, artist: songB.artist } : null,
        caption: songB
          ? `${songA.song.toLowerCase()} by ${songA.artist.toLowerCase()} into ${songB.song.toLowerCase()} by ${songB.artist.toLowerCase()}`
          : songA
            ? `${songA.song.toLowerCase()} by ${songA.artist.toLowerCase()}`
            : '(unknown)',
      };

      const reasons = (candidate.reasons || []).join(', ');
      const songLabel = songB ? `${songA.song} → ${songB.song}` : songA?.song || '?';
      console.log(`  ${clipName}: ${fmt(startSec)}-${fmt(endSec)} | ${songLabel} [${reasons}, score:${candidate.score}]`);

      if (!dryRun) {
        cutClip(startSec, clipDuration, clipPath);
        const sizeMB = (fs.statSync(clipPath).size / 1048576).toFixed(1);
        console.log(`    ✅ ${sizeMB}MB`);
      }

      clips.push(clipInfo);
    }

    console.log(`\n  ${peakCount} peak clips (${candidates.length - peakCount} skipped for overlap)\n`);
  }

  // ── Save manifest ──────────────────────────────────────────────
  const manifest = {
    source: path.basename(input),
    createdAt: new Date().toISOString(),
    clipDuration,
    totalClips: clips.length,
    transitionClips: transitionCount,
    peakClips: clips.length - transitionCount,
    clips,
  };

  const manifestPath = path.join(outputDir, 'clips-manifest.json');
  if (!dryRun) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`📋 Manifest: ${manifestPath}`);
  }

  console.log(`\n✅ Done: ${clips.length} clips (${transitionCount} transitions + ${clips.length - transitionCount} peaks)`);

  // Output manifest JSON to stdout for piping
  console.log('\n---JSON---');
  console.log(JSON.stringify(manifest));
}

main().catch(e => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
