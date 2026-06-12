#!/usr/bin/env node
/**
 * Cut a clip from source video using FFmpeg.
 * Crops to 9:16, adds text overlays, encodes for TikTok.
 *
 * Usage:
 *   node cut.js --input /tmp/source.mp4 --start 125.5 --duration 45 \
 *     --output /tmp/clip_001.mp4 [--artist "The Reflections"] \
 *     [--event "Summer Sessions"] [--brand "My Event"] \
 *     [--crop center|left|right] [--max-size-mb 4]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG = process.env.FFMPEG_PATH || path.join(process.env.HOME, 'bin', 'ffmpeg');
const FFPROBE = process.env.FFPROBE_PATH || path.join(process.env.HOME, 'bin', 'ffprobe');

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}
function hasFlag(name) { return args.includes(`--${name}`); }

const input = getArg('input');
const startSec = parseFloat(getArg('start') || '0');
const duration = parseFloat(getArg('duration') || '45');
const output = getArg('output');
const artist = getArg('artist') || '';
const event = getArg('event') || '';
const brand = getArg('brand') || 'Live Event';
const cropMode = getArg('crop') || 'center'; // center, left, right
const maxSizeMB = parseFloat(getArg('max-size-mb') || '50'); // generous default, Dropspace URL upload = 512MB
// Default to no-overlay since static FFmpeg lacks drawtext filter.
// Text overlays require FFmpeg built with --enable-libfreetype.
const noOverlay = true; // TODO: detect drawtext support and enable when available

if (!input || !output) {
  console.error('Usage: node cut.js --input <video> --start <sec> --duration <sec> --output <path>');
  console.error('       [--artist "..."] [--event "..."] [--brand "..."] [--crop center|left|right]');
  process.exit(1);
}

// Get source video dimensions
function getVideoInfo() {
  const raw = execSync(
    `"${FFPROBE}" -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of json "${input}"`,
    { encoding: 'utf-8' }
  );
  const info = JSON.parse(raw);
  const stream = info.streams[0];
  const [num, den] = stream.r_frame_rate.split('/').map(Number);
  return {
    width: stream.width,
    height: stream.height,
    fps: Math.round(num / den),
  };
}

function buildFilterGraph(srcWidth, srcHeight) {
  const filters = [];

  // Step 1: Crop to 9:16 aspect ratio
  const targetRatio = 9 / 16;
  const srcRatio = srcWidth / srcHeight;

  let cropW, cropH, cropX, cropY;

  if (srcRatio > targetRatio) {
    // Source is wider — crop width
    cropH = srcHeight;
    cropW = Math.round(srcHeight * targetRatio);
    cropY = 0;

    switch (cropMode) {
      case 'left': cropX = 0; break;
      case 'right': cropX = srcWidth - cropW; break;
      default: cropX = Math.round((srcWidth - cropW) / 2); // center
    }
  } else {
    // Source is taller — crop height
    cropW = srcWidth;
    cropH = Math.round(srcWidth / targetRatio);
    cropX = 0;
    cropY = Math.round((srcHeight - cropH) / 2);
  }

  filters.push(`crop=${cropW}:${cropH}:${cropX}:${cropY}`);

  // Step 2: Scale to 1080x1920
  filters.push('scale=1080:1920:flags=lanczos');

  // Step 3: Text overlays (if not disabled)
  if (!noOverlay) {
    const escapedBrand = brand.replace(/'/g, "'\\''").replace(/:/g, '\\:');
    const escapedArtist = artist.replace(/'/g, "'\\''").replace(/:/g, '\\:');
    const escapedEvent = event.replace(/'/g, "'\\''").replace(/:/g, '\\:');

    // Brand watermark (top-left, small, subtle)
    if (brand) {
      filters.push(
        `drawtext=text='${escapedBrand}':fontsize=32:fontcolor=white@0.7:x=40:y=60:fontfile=/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf:shadowx=2:shadowy=2:shadowcolor=black@0.5`
      );
    }

    // Artist name (bottom area, large)
    if (artist) {
      filters.push(
        `drawtext=text='${escapedArtist}':fontsize=56:fontcolor=white:x=(w-tw)/2:y=h-200:fontfile=/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf:shadowx=3:shadowy=3:shadowcolor=black@0.8`
      );
    }

    // Event name (below artist, smaller)
    if (event) {
      filters.push(
        `drawtext=text='${escapedEvent}':fontsize=36:fontcolor=white@0.85:x=(w-tw)/2:y=h-130:fontfile=/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf:shadowx=2:shadowy=2:shadowcolor=black@0.5`
      );
    }
  }

  return filters.join(',');
}

function formatTimestamp(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

async function main() {
  console.log(`✂️  Cutting clip from ${path.basename(input)}`);
  console.log(`   Range: ${formatTimestamp(startSec)} → ${formatTimestamp(startSec + duration)} (${duration}s)`);

  const { width, height, fps } = getVideoInfo();
  console.log(`   Source: ${width}×${height} @ ${fps}fps`);

  const filterGraph = buildFilterGraph(width, height);

  // Target bitrate calculation for size constraint
  // Total bits = maxSizeMB * 8 * 1024 * 1024
  // Audio ~128kbps, video = (total - audio) / duration
  const totalBits = maxSizeMB * 8 * 1024 * 1024;
  const audioBits = 128 * 1024 * duration;
  const videoBitrate = Math.floor((totalBits - audioBits) / duration);
  const videoBitrateK = Math.round(videoBitrate / 1024);

  // Use CRF for quality-based encoding, with maxrate cap
  const cmd = [
    `"${FFMPEG}"`,
    `-ss ${startSec}`,
    `-i "${input}"`,
    `-t ${duration}`,
    `-vf "${filterGraph}"`,
    `-c:v libx264 -preset medium -crf 23`,
    `-maxrate ${videoBitrateK}k -bufsize ${videoBitrateK * 2}k`,
    `-c:a aac -b:a 128k -ac 2 -ar 44100`,
    `-movflags +faststart`, // enables streaming playback
    `-y "${output}"`,
  ].join(' ');

  console.log(`   Encoding (CRF 23, maxrate ${videoBitrateK}k)...`);

  try {
    execSync(cmd, { encoding: 'utf-8', timeout: 300000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    // FFmpeg outputs to stderr, check if output file exists
    if (!fs.existsSync(output)) {
      console.error(`❌ FFmpeg failed: ${e.stderr?.slice(-500) || e.message}`);
      process.exit(1);
    }
  }

  const stat = fs.statSync(output);
  const sizeMB = (stat.size / 1048576).toFixed(1);
  console.log(`   ✅ Clip: ${output} (${sizeMB}MB)`);

  if (stat.size > maxSizeMB * 1048576) {
    console.warn(`   ⚠️ Clip exceeds ${maxSizeMB}MB target — consider reducing duration or quality`);
  }

  // Output metadata
  const result = {
    path: output,
    sizeMB: parseFloat(sizeMB),
    durationSec: duration,
    startSec,
    artist,
    event,
    brand,
    cropMode,
  };
  console.log(JSON.stringify(result));
}

main().catch(e => {
  console.error(`❌ Cut failed: ${e.message}`);
  process.exit(1);
});
