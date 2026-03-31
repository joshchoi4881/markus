/**
 * Reusable text overlay module for image-based content.
 *
 * Extracted from create-visual-post-engine.js for use across:
 *   - AI-generated visual posts (story-slideshow)
 *   - Drive-sourced photo slideshows (community events)
 *   - Any future image + text pipeline
 *
 * Usage:
 *   const { initCanvas, addOverlay, OVERLAY_PRESETS } = require('./overlay');
 *   initCanvas();  // call once at startup
 *   await addOverlay(inputPath, 'your text', outputPath, { preset: 'story-slideshow' });
 */

const fs = require('fs');
const path = require('path');

let canvasModule = null;
let fontRegistered = false;

// ── Canvas initialization ──────────────────────────────────────

const CANVAS_SEARCH_PATHS = [
  path.join(process.env.HOME || '', 'dropspace', 'node_modules', 'canvas'),
  'canvas',
];

const FONT_BOLD_SEARCH = [
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/LiberationSans-Bold.ttf',
  path.join(process.env.HOME || '', '.npm-global/lib/node_modules/openclaw/node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf'),
];

const FONT_REGULAR_SEARCH = [
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  path.join(process.env.HOME || '', '.npm-global/lib/node_modules/openclaw/node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'),
];

/**
 * Initialize canvas module and register fonts.
 * Call once before using addOverlay.
 * @returns {object} The canvas module
 */
function initCanvas() {
  if (canvasModule) return canvasModule;

  for (const cp of CANVAS_SEARCH_PATHS) {
    try { canvasModule = require(cp); break; } catch {}
  }
  if (!canvasModule) {
    throw new Error('node-canvas not installed. Install via: cd ~/dropspace && npm install canvas');
  }

  const { registerFont } = canvasModule;

  // Register bold font
  for (const fp of FONT_BOLD_SEARCH) {
    if (fs.existsSync(fp)) {
      try { registerFont(fp, { family: 'Arial', weight: 'bold' }); fontRegistered = true; break; }
      catch (e) { console.warn(`⚠️ Could not register font ${fp}: ${e.message}`); }
    }
  }
  if (!fontRegistered) console.warn('⚠️ No bold font found — text overlays may render as boxes.');

  // Register regular font
  for (const fp of FONT_REGULAR_SEARCH) {
    if (fs.existsSync(fp)) {
      try { registerFont(fp, { family: 'Arial', weight: 'normal' }); break; } catch {}
    }
  }

  return canvasModule;
}

// ── Text wrapping ──────────────────────────────────────────────

function wrapText(ctx, text, maxWidth) {
  const cleanText = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
  const lines = [];
  for (const line of cleanText.split('\n')) {
    if (ctx.measureText(line.trim()).width <= maxWidth) { lines.push(line.trim()); continue; }
    let current = '';
    for (const word of line.trim().split(/\s+/)) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth) { current = test; }
      else { if (current) lines.push(current); current = word; }
    }
    if (current) lines.push(current);
  }
  return lines;
}

// ── Overlay presets ────────────────────────────────────────────

const OVERLAY_PRESETS = {
  // Larry: upper-third, fixed 6.5%, white text with black stroke
  'story-slideshow': {
    position: 'upper-third',
    fontScale: 'fixed-6.5',
    stroke: true,
    fill: '#FFFFFF',
    strokeColor: '#000000',
    bg: null,
  },
  // Photo slideshow: matches story-slideshow style (no bg box, stroke only) with face-aware repositioning
  'photo-slideshow': {
    position: 'upper-third',
    fontScale: 'fixed-6.5',
    stroke: true,
    fill: '#FFFFFF',
    strokeColor: '#000000',
    bg: null,
    faceAware: true,
  },
  // Minimal: small text, lower third, subtle
  'minimal': {
    position: 'lower-third',
    fontScale: 'auto',
    stroke: true,
    fill: '#FFFFFF',
    strokeColor: '#000000',
    bg: null,
  },
};

// ── Main overlay function ──────────────────────────────────────

/**
 * Add text overlay to an image.
 *
 * @param {string} imgPath - Path to source image
 * @param {string} text - Text to overlay
 * @param {string} outPath - Path to write result (PNG)
 * @param {object} options
 * @param {string} [options.preset] - Preset name from OVERLAY_PRESETS
 * @param {object} [options.style] - Custom style (overrides preset)
 * @param {number} [options.slideIndex] - Slide index (for position: 'top-bottom')
 * @param {boolean} [options.hasFace] - Whether the image contains a human face (triggers repositioning for faceAware presets)
 * @returns {Promise<string[]>} Lines rendered
 */
async function addOverlay(imgPath, text, outPath, options = {}) {
  if (!canvasModule) initCanvas();

  const style = { ...(options.style || OVERLAY_PRESETS[options.preset] || OVERLAY_PRESETS['story-slideshow']) };
  const slideIndex = options.slideIndex || 0;

  // Face-aware repositioning: if the preset is faceAware and the image has a face,
  // move text to bottom-safe position to avoid overlapping faces.
  if (style.faceAware && options.hasFace) {
    style.position = 'bottom-safe';
  }

  const img = await canvasModule.loadImage(imgPath);
  const canvas = canvasModule.createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const wordCount = text.split(/\s+/).length;

  // Font sizing
  let fontSizePercent;
  if (style.fontScale === 'fixed-6.5') {
    fontSizePercent = 0.065;
  } else if (style.fontScale === 'large') {
    fontSizePercent = wordCount <= 5 ? 0.085 : wordCount <= 12 ? 0.070 : 0.055;
  } else if (style.fontScale === 'impact') {
    fontSizePercent = wordCount <= 8 ? 0.090 : 0.065;
  } else {
    // auto
    fontSizePercent = wordCount <= 5 ? 0.075 : wordCount <= 12 ? 0.065 : 0.050;
  }

  const fontSize = Math.round(img.width * fontSizePercent);
  const outlineWidth = Math.round(fontSize * 0.15);
  const maxWidth = img.width * (style.bg ? 0.85 : 0.75);
  const lineHeight = fontSize * 1.25;

  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const lines = wrapText(ctx, text, maxWidth);
  const totalHeight = lines.length * lineHeight;

  // Position calculation — safe zones: top 10% (status bar), bottom 20% (TikTok UI)
  const minSafeY = img.height * 0.10;
  const maxSafeY = img.height * 0.80 - totalHeight;
  let safeY;

  if (style.position === 'center') {
    safeY = Math.max(minSafeY, Math.min((img.height - totalHeight) / 2, maxSafeY));
  } else if (style.position === 'bottom-safe') {
    // Bottom of the image, above TikTok UI (bottom 20%) but below faces.
    // Places text at ~72% from top — low enough to avoid most faces,
    // high enough to stay above TikTok's bottom UI controls.
    safeY = Math.max(minSafeY, Math.min(img.height * 0.72, maxSafeY));
  } else if (style.position === 'lower-third') {
    safeY = Math.max(minSafeY, Math.min(img.height * 0.65 - totalHeight / 2, maxSafeY));
  } else if (style.position === 'top-bottom') {
    safeY = slideIndex % 2 === 0
      ? minSafeY + img.height * 0.01
      : maxSafeY;
  } else {
    // upper-third (default): centered at 30% from top
    const rawY = (img.height * 0.30) - (totalHeight / 2) + (lineHeight / 2);
    safeY = Math.max(minSafeY, Math.min(rawY, maxSafeY));
  }

  const x = img.width / 2;

  // Background box
  if (style.bg) {
    const pad = img.width * (style.bgPadding || 0.03);
    const boxWidth = maxWidth + pad * 2;
    const boxHeight = totalHeight + pad * 2;
    const boxX = (img.width - boxWidth) / 2;
    const boxY = safeY - pad;
    ctx.fillStyle = style.bg;
    ctx.beginPath();
    const r = Math.round(img.width * 0.02);
    ctx.moveTo(boxX + r, boxY);
    ctx.lineTo(boxX + boxWidth - r, boxY);
    ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + r);
    ctx.lineTo(boxX + boxWidth, boxY + boxHeight - r);
    ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - r, boxY + boxHeight);
    ctx.lineTo(boxX + r, boxY + boxHeight);
    ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - r);
    ctx.lineTo(boxX, boxY + r);
    ctx.quadraticCurveTo(boxX, boxY, boxX + r, boxY);
    ctx.fill();
  }

  // Draw text
  for (let i = 0; i < lines.length; i++) {
    const y = safeY + (i * lineHeight);
    if (style.stroke) {
      ctx.strokeStyle = style.strokeColor || '#000000';
      ctx.lineWidth = outlineWidth;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(lines[i], x, y);
    }
    ctx.fillStyle = style.fill || '#FFFFFF';
    ctx.fillText(lines[i], x, y);
  }

  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  return lines;
}

module.exports = {
  initCanvas,
  addOverlay,
  wrapText,
  OVERLAY_PRESETS,
};
