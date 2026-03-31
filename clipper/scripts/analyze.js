#!/usr/bin/env node
/**
 * Analyze a DJ set / video to find clip-worthy moments.
 *
 * Uses multi-signal audio analysis:
 *   1. Spectral flux  — detects transitions (new track coming in, filter sweeps)
 *   2. Energy variance — detects builds → drops (rising energy then sudden spike)
 *   3. Bass ratio shift — detects bass drops/cuts (classic DJ transition move)
 *   4. RMS energy — detects overall peak moments
 *
 * Each candidate is scored and labeled with why it's interesting.
 *
 * Usage:
 *   node analyze.js --input set.mp4 --top 15 --min-gap 45 --clip-duration 30
 *   node analyze.js --input set.mp4 --output analysis.json
 *
 * Output: JSON array of scored candidate moments with reasons.
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
const topN = parseInt(getArg('top', '15'));
const minGap = parseInt(getArg('min-gap', '45'));
const clipDuration = parseInt(getArg('clip-duration', '30'));
const outputFile = getArg('output', null);

if (!input || !fs.existsSync(input)) {
  console.error('Usage: node analyze.js --input /path/to/video.mp4 [--top 15] [--min-gap 45] [--clip-duration 30]');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────

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

// ── Audio extraction ─────────────────────────────────────────────

function extractAudio() {
  console.error('🔊 Extracting audio...');

  // Extract mono 16kHz f32le — enough resolution for spectral analysis
  const SAMPLE_RATE = 16000;
  const cmd = `"${FFMPEG}" -i "${input}" -ac 1 -ar ${SAMPLE_RATE} -f f32le -acodec pcm_f32le - 2>/dev/null`;
  const buf = execSync(cmd, { maxBuffer: 1024 * 1024 * 1024, timeout: 600000 });
  const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);

  console.error(`   ${samples.length} samples (${(samples.length / SAMPLE_RATE / 60).toFixed(1)} min @ ${SAMPLE_RATE}Hz)`);
  return { samples, sampleRate: SAMPLE_RATE };
}

// ── Per-second feature extraction ────────────────────────────────

function extractFeatures(samples, sampleRate) {
  console.error('📊 Computing features...');

  const totalSeconds = Math.floor(samples.length / sampleRate);
  const features = [];

  // Use FFmpeg to extract band energies efficiently instead of JS DFT
  // For now: fast approach using simple IIR-like band splitting
  // Split signal into 4 bands via cumulative energy in frequency ranges
  // Using overlapping Hann-windowed FFT with radix-2 (much faster than per-bin Goertzel)

  const fftSize = 1024; // ~16ms windows at 16kHz, fast to compute
  const binWidth = sampleRate / fftSize;

  // Band boundaries in bins
  const bandBins = [
    [0, Math.ceil(100 / binWidth)],       // sub-bass: 0-100Hz
    [Math.ceil(100 / binWidth), Math.ceil(300 / binWidth)],  // bass: 100-300Hz
    [Math.ceil(300 / binWidth), Math.ceil(3000 / binWidth)], // mid: 300-3kHz
    [Math.ceil(3000 / binWidth), fftSize / 2],               // high: 3k+
  ];

  // Precompute Hann window
  const hann = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / fftSize));

  // Simple in-place radix-2 FFT (real input → magnitude)
  function fftMagnitude(input) {
    const N = input.length;
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    for (let i = 0; i < N; i++) re[i] = input[i];

    // Bit-reversal permutation
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      while (j & bit) { j ^= bit; bit >>= 1; }
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; }
    }

    // Cooley-Tukey
    for (let len = 2; len <= N; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wRe = Math.cos(ang), wIm = Math.sin(ang);
      for (let i = 0; i < N; i += len) {
        let curRe = 1, curIm = 0;
        for (let j = 0; j < len / 2; j++) {
          const a = i + j, b = a + len / 2;
          const tRe = curRe * re[b] - curIm * im[b];
          const tIm = curRe * im[b] + curIm * re[b];
          re[b] = re[a] - tRe; im[b] = im[a] - tIm;
          re[a] += tRe; im[a] += tIm;
          const newCurRe = curRe * wRe - curIm * wIm;
          curIm = curRe * wIm + curIm * wRe;
          curRe = newCurRe;
        }
      }
    }

    // Magnitude spectrum (first half only)
    const mag = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) mag[i] = re[i] * re[i] + im[i] * im[i];
    return mag;
  }

  for (let sec = 0; sec < totalSeconds; sec++) {
    const secStart = sec * sampleRate;
    const secEnd = secStart + sampleRate;

    // RMS
    let sumSq = 0;
    for (let i = secStart; i < secEnd && i < samples.length; i++) sumSq += samples[i] * samples[i];
    const rms = Math.sqrt(sumSq / sampleRate);

    // Band energy: average FFT across frames in this second
    const numFrames = Math.floor(sampleRate / fftSize);
    const bandEnergy = [0, 0, 0, 0];

    for (let frame = 0; frame < numFrames; frame++) {
      const fStart = secStart + frame * fftSize;
      const windowed = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) windowed[i] = (samples[fStart + i] || 0) * hann[i];

      const mag = fftMagnitude(windowed);

      for (let b = 0; b < 4; b++) {
        const [lo, hi] = bandBins[b];
        for (let bin = lo; bin < hi && bin < mag.length; bin++) bandEnergy[b] += mag[bin];
      }
    }

    const totalBandEnergy = bandEnergy.reduce((a, b) => a + b, 0) || 1;
    const bassRatio = (bandEnergy[0] + bandEnergy[1]) / totalBandEnergy;

    features.push({
      sec,
      rms,
      bandEnergy: bandEnergy.map(e => e / (numFrames || 1)),
      bassRatio,
      totalEnergy: totalBandEnergy / (numFrames || 1),
    });

    // Progress every 5 minutes of audio
    if (sec > 0 && sec % 300 === 0) console.error(`   ... ${fmt(sec)} processed`);
  }

  console.error(`   ${features.length} seconds analyzed`);
  return features;
}

// ── Spectral flux (transition detection) ─────────────────────────

function computeSpectralFlux(features) {
  // Spectral flux = how much the frequency profile changes between adjacent seconds
  const flux = [0]; // first second has no predecessor
  for (let i = 1; i < features.length; i++) {
    const prev = features[i - 1].bandEnergy;
    const curr = features[i].bandEnergy;
    let diff = 0;
    for (let b = 0; b < 4; b++) {
      const d = curr[b] - prev[b];
      diff += d > 0 ? d : 0; // half-wave rectified (only increases)
    }
    flux.push(diff);
  }
  return flux;
}

// ── Energy variance (build → drop detection) ─────────────────────

function computeEnergyVariance(features, windowSec = 8) {
  // Variance of RMS energy in a sliding window — high = dynamic section
  const variance = [];
  for (let i = 0; i < features.length; i++) {
    const start = Math.max(0, i - windowSec);
    const end = Math.min(features.length, i + windowSec + 1);
    const window = features.slice(start, end).map(f => f.rms);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const v = window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length;
    variance.push(v);
  }
  return variance;
}

// ── Bass ratio change (bass drop/cut detection) ──────────────────

function computeBassShift(features, windowSec = 3) {
  // How much the bass ratio changes — bass drops/cuts create big shifts
  const shift = [0];
  for (let i = 1; i < features.length; i++) {
    const prevStart = Math.max(0, i - windowSec);
    const prevAvg = features.slice(prevStart, i).reduce((s, f) => s + f.bassRatio, 0) / (i - prevStart);
    shift.push(Math.abs(features[i].bassRatio - prevAvg));
  }
  return shift;
}

// ── Scoring & candidate selection ────────────────────────────────

function normalize(arr) {
  const max = Math.max(...arr);
  return max > 0 ? arr.map(v => v / max) : arr;
}

function smooth(arr, windowSec = 5) {
  return arr.map((_, i) => {
    const start = Math.max(0, i - windowSec);
    const end = Math.min(arr.length, i + windowSec + 1);
    return arr.slice(start, end).reduce((a, b) => a + b, 0) / (end - start);
  });
}

function findCandidates(features, duration) {
  const flux = normalize(smooth(computeSpectralFlux(features), 3));
  const variance = normalize(smooth(computeEnergyVariance(features), 3));
  const bassShift = normalize(smooth(computeBassShift(features), 3));
  const energy = normalize(smooth(features.map(f => f.rms), 3));

  // Composite score — weighted combination
  // Spectral flux (transitions) is weighted highest for DJ sets
  const WEIGHTS = {
    flux: 0.35,       // transitions between tracks
    variance: 0.25,   // builds → drops
    bassShift: 0.20,  // bass drops/cuts
    energy: 0.20,     // overall energy peaks
  };

  const scores = features.map((f, i) => {
    const score =
      WEIGHTS.flux * flux[i] +
      WEIGHTS.variance * variance[i] +
      WEIGHTS.bassShift * bassShift[i] +
      WEIGHTS.energy * energy[i];

    // Determine primary reason
    const signals = [
      { name: 'transition', val: flux[i], threshold: 0.5 },
      { name: 'build-drop', val: variance[i], threshold: 0.5 },
      { name: 'bass-shift', val: bassShift[i], threshold: 0.5 },
      { name: 'energy-peak', val: energy[i], threshold: 0.5 },
    ].filter(s => s.val >= s.threshold).sort((a, b) => b.val - a.val);

    return {
      sec: f.sec,
      score,
      reasons: signals.map(s => s.name),
      signals: {
        flux: Math.round(flux[i] * 100),
        variance: Math.round(variance[i] * 100),
        bassShift: Math.round(bassShift[i] * 100),
        energy: Math.round(energy[i] * 100),
      },
    };
  });

  // Find local maxima in the composite score
  const windowSize = Math.floor(minGap / 2);
  const candidates = [];

  for (let i = windowSize; i < scores.length - windowSize; i++) {
    const s = scores[i];
    if (s.score < 0.3) continue; // minimum threshold

    // Check if local maximum
    const neighborhood = scores.slice(Math.max(0, i - windowSize), i + windowSize + 1);
    const isMax = neighborhood.every(n => s.score >= n.score);
    if (!isMax) continue;

    candidates.push(s);
  }

  candidates.sort((a, b) => b.score - a.score);

  // Select top N with minimum gap
  const selected = [];
  for (const c of candidates) {
    if (selected.length >= topN) break;
    if (selected.some(s => Math.abs(s.sec - c.sec) < minGap)) continue;

    // Calculate clip bounds (center the peak)
    const half = clipDuration / 2;
    let startSec = Math.max(0, c.sec - half);
    if (startSec + clipDuration > duration) startSec = Math.max(0, duration - clipDuration);

    selected.push({
      startSec: Math.round(startSec),
      peakSec: c.sec,
      endSec: Math.round(startSec + clipDuration),
      score: Math.round(c.score * 100),
      reasons: c.reasons.length > 0 ? c.reasons : ['energy-peak'],
      signals: c.signals,
    });
  }

  selected.sort((a, b) => a.startSec - b.startSec);
  return selected;
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.error(`🎬 Analyzing: ${path.basename(input)}`);

  const duration = getDuration();
  console.error(`   Duration: ${fmt(duration)} (${Math.round(duration)}s)`);

  const { samples, sampleRate } = extractAudio();
  const features = extractFeatures(samples, sampleRate);
  const candidates = findCandidates(features, duration);

  console.error(`\n📋 Top ${candidates.length} clip candidates:\n`);

  const reasonEmoji = {
    'transition': '🔀',
    'build-drop': '📈',
    'bass-shift': '🔊',
    'energy-peak': '⚡',
  };

  for (const [i, c] of candidates.entries()) {
    const reasons = c.reasons.map(r => `${reasonEmoji[r] || ''} ${r}`).join(', ');
    console.error(
      `   ${String(i + 1).padStart(2)}. ${fmt(c.startSec)} → ${fmt(c.endSec)}` +
      `  (peak: ${fmt(c.peakSec)}, score: ${c.score}%)` +
      `  [${reasons}]`
    );
    console.error(
      `       flux:${c.signals.flux} var:${c.signals.variance} bass:${c.signals.bassShift} energy:${c.signals.energy}`
    );
  }

  const output = JSON.stringify(candidates, null, 2);
  if (outputFile) {
    fs.writeFileSync(outputFile, output);
    console.error(`\n✅ Saved to ${outputFile}`);
  } else {
    console.log(output);
  }
}

main().catch(e => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
