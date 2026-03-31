#!/usr/bin/env node
/**
 * fal-generate.js — Generate images or videos via Fal.ai Queue API
 *
 * Usage:
 *   node fal-generate.js image --prompt "a cat" [--aspect 9:16] [--model fal-ai/nano-banana-2] [--out /tmp/img.png]
 *   node fal-generate.js video --prompt "a cat walking" [--aspect 9:16] [--duration 8] [--model fal-ai/veo3.1] [--out /tmp/vid.mp4]
 *   node fal-generate.js status --model fal-ai/nano-banana-2 --request-id <id>
 *   node fal-generate.js result --model fal-ai/nano-banana-2 --request-id <id> [--out /tmp/img.png]
 *
 * Env: FAL_KEY (required)
 *
 * Outputs JSON to stdout. If --out is specified, also downloads the result to that path.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Config ──
const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) {
  console.error('Error: FAL_KEY environment variable required');
  process.exit(1);
}

const DEFAULT_IMAGE_MODEL = 'fal-ai/nano-banana-2';
const DEFAULT_VIDEO_MODEL = 'fal-ai/veo3.1';

// ── Arg parsing ──
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}
function hasArg(name) { return args.indexOf(`--${name}`) !== -1; }
const command = args[0];

// ── HTTP helpers ──
function request(url, method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: {
        'Authorization': `Key ${FAL_KEY}`,
        'Content-Type': 'application/json',
        ...headers,
      },
    };
    const req = mod.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, data: raw }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => { ws.close(); resolve(dest); });
      ws.on('error', reject);
    });
    req.on('error', reject);
  });
}

// ── Poll for completion ──
// Uses status_url and response_url from submit response (handles deep subpaths like veo3.1)
async function pollUntilDone(submitData, timeoutMs = 300000) {
  const statusUrl = submitData.status_url;
  const responseUrl = submitData.response_url;
  const requestId = submitData.request_id;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const { data } = await request(statusUrl, 'GET');
    const status = data.status || data;

    if (status === 'COMPLETED' || data.status === 'COMPLETED') {
      // Fetch result using response_url from submit
      const { data: result } = await request(responseUrl, 'GET');
      return result;
    }

    if (status === 'FAILED' || data.status === 'FAILED') {
      throw new Error(`Generation failed: ${JSON.stringify(data)}`);
    }

    // Log queue position if available
    if (data.queue_position !== undefined) {
      process.stderr.write(`Queue position: ${data.queue_position}\n`);
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  throw new Error(`Timeout after ${timeoutMs}ms waiting for ${requestId}`);
}

// ── Commands ──
async function submitImage() {
  const prompt = getArg('prompt');
  if (!prompt) { console.error('Error: --prompt required'); process.exit(1); }

  const model = getArg('model') || DEFAULT_IMAGE_MODEL;
  const aspect = getArg('aspect') || '9:16';
  const outPath = getArg('out');
  const noWait = hasArg('no-wait');

  const input = {
    prompt,
    aspect_ratio: aspect,
    output_format: 'png',
    num_images: 1,
  };

  // Reference image support (for edit endpoint)
  const refImage = getArg('reference-image');
  const actualModel = refImage ? `${model}/edit` : model;
  if (refImage) input.reference_image_url = refImage;

  process.stderr.write(`Submitting image to ${actualModel}...\n`);
  const { status, data } = await request(`https://queue.fal.run/${actualModel}`, 'POST', input);

  if (status >= 400) {
    console.error(`Submit failed (${status}):`, JSON.stringify(data));
    process.exit(1);
  }

  const requestId = data.request_id;
  process.stderr.write(`Request ID: ${requestId}\n`);

  if (noWait) {
    console.log(JSON.stringify({ request_id: requestId, model: actualModel, ...data }));
    return;
  }

  // Poll for result
  const timeout = parseInt(getArg('timeout') || '120000');
  const result = await pollUntilDone(data, timeout);

  if (outPath && result.images?.[0]?.url) {
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await download(result.images[0].url, outPath);
    process.stderr.write(`Downloaded to ${outPath}\n`);
  }

  console.log(JSON.stringify({
    request_id: requestId,
    model: actualModel,
    images: result.images || [],
    seed: result.seed,
    timings: result.timings,
  }));
}

async function submitVideo() {
  const prompt = getArg('prompt');
  if (!prompt) { console.error('Error: --prompt required'); process.exit(1); }

  const model = getArg('model') || DEFAULT_VIDEO_MODEL;
  const aspect = getArg('aspect') || '9:16';
  const duration = parseInt(getArg('duration') || '8');
  const outPath = getArg('out');
  const noWait = hasArg('no-wait');

  const input = {
    prompt,
    aspect_ratio: aspect,
    duration: duration,
  };

  process.stderr.write(`Submitting video to ${model}...\n`);
  const { status, data } = await request(`https://queue.fal.run/${model}`, 'POST', input);

  if (status >= 400) {
    console.error(`Submit failed (${status}):`, JSON.stringify(data));
    process.exit(1);
  }

  const requestId = data.request_id;
  process.stderr.write(`Request ID: ${requestId}\n`);

  if (noWait) {
    console.log(JSON.stringify({ request_id: requestId, model, ...data }));
    return;
  }

  // Poll for result (videos take longer)
  const timeout = parseInt(getArg('timeout') || '300000');
  const result = await pollUntilDone(data, timeout);

  if (outPath && result.video?.url) {
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await download(result.video.url, outPath);
    process.stderr.write(`Downloaded to ${outPath}\n`);
  }

  console.log(JSON.stringify({
    request_id: requestId,
    model,
    video: result.video || null,
    timings: result.timings,
  }));
}

async function checkStatus() {
  const model = getArg('model');
  const requestId = getArg('request-id');
  if (!model || !requestId) {
    console.error('Error: --model and --request-id required');
    process.exit(1);
  }

  const baseModel = model.split('/').slice(0, 2).join('/');
  const { data } = await request(
    `https://queue.fal.run/${baseModel}/requests/${requestId}/status`, 'GET'
  );
  console.log(JSON.stringify(data));
}

async function getResult() {
  const model = getArg('model');
  const requestId = getArg('request-id');
  if (!model || !requestId) {
    console.error('Error: --model and --request-id required');
    process.exit(1);
  }

  const baseModel = model.split('/').slice(0, 2).join('/');
  const outPath = getArg('out');
  const { data } = await request(
    `https://queue.fal.run/${baseModel}/requests/${requestId}`, 'GET'
  );

  if (outPath) {
    const url = data.images?.[0]?.url || data.video?.url;
    if (url) {
      const dir = path.dirname(outPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await download(url, outPath);
      process.stderr.write(`Downloaded to ${outPath}\n`);
    }
  }

  console.log(JSON.stringify(data));
}

// ── Main ──
(async () => {
  try {
    switch (command) {
      case 'image': await submitImage(); break;
      case 'video': await submitVideo(); break;
      case 'status': await checkStatus(); break;
      case 'result': await getResult(); break;
      default:
        console.error(`Usage: fal-generate.js <image|video|status|result> [options]`);
        console.error(`  image  --prompt "..." [--aspect 9:16] [--model ...] [--out path] [--no-wait] [--reference-image url]`);
        console.error(`  video  --prompt "..." [--aspect 9:16] [--duration 8] [--model ...] [--out path] [--no-wait]`);
        console.error(`  status --model ... --request-id <id>`);
        console.error(`  result --model ... --request-id <id> [--out path]`);
        process.exit(1);
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
})();
