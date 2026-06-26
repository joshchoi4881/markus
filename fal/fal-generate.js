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

// A Fal job failure (or submit response) that is transient and worth resubmitting rather than
// failing the whole post. veo3.1 generates audio via ElevenLabs TTS, which caps our subscription
// at 3 concurrent requests; under batch load the job returns FAILED with a 429
// `concurrent_limit_exceeded` / `rate_limit_error`. A freed slot resolves it within seconds.
// (MARKUS-3: ~55 warn/wk of exactly this.)
function isTransientFalFailure(err) {
  const msg = (err && err.message ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('concurrent_limit_exceeded') ||
    msg.includes('rate_limit_error') ||
    msg.includes('too many concurrent') ||
    msg.includes('rate limit')
  );
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

  // Submit + poll with budget-aware retry. veo3.1's downstream ElevenLabs TTS caps at 3 concurrent
  // requests on our plan, so under batch load the submit 429s or the job returns FAILED with a
  // transient `concurrent_limit_exceeded`. Resubmitting a fresh job after a short backoff succeeds
  // once a slot frees — and is safe: a FAILED job produced no output, so there's no duplicate video.
  // All attempts share the one `--timeout` budget so we never overrun the parent execSync bound.
  // (MARKUS-3: ~55 warn/wk of exactly this 429.)
  const timeout = parseInt(getArg('timeout') || '300000');
  const MAX_ATTEMPTS = 3;
  const deadline = Date.now() + timeout;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (deadline - Date.now() < 30000) break; // not enough budget left for another generation

    process.stderr.write(`Submitting video to ${model} (attempt ${attempt}/${MAX_ATTEMPTS})...\n`);
    const { status, data } = await request(`https://queue.fal.run/${model}`, 'POST', input);

    if (status >= 400) {
      if ((status === 429 || status >= 500) && attempt < MAX_ATTEMPTS) {
        const wait = Math.min(attempt * 4000, 15000);
        process.stderr.write(`Submit ${status} — retrying in ${wait}ms\n`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      console.error(`Submit failed (${status}):`, JSON.stringify(data));
      process.exit(1);
    }

    const requestId = data.request_id;
    process.stderr.write(`Request ID: ${requestId}\n`);

    if (noWait) {
      console.log(JSON.stringify({ request_id: requestId, model, ...data }));
      return;
    }

    try {
      // Poll for result (videos take longer); cap to the remaining shared budget.
      const result = await pollUntilDone(data, deadline - Date.now());

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
      return;
    } catch (e) {
      lastErr = e;
      if (isTransientFalFailure(e) && attempt < MAX_ATTEMPTS && deadline - Date.now() > 30000) {
        const wait = Math.min(attempt * 4000, 15000);
        process.stderr.write(`Transient generation failure — retrying in ${wait}ms: ${e.message}\n`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }

  throw lastErr || new Error(`video generation failed within ${timeout}ms budget`);
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
