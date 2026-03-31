/**
 * Media generation abstraction layer.
 *
 * Routes image/video generation to the configured provider.
 * Providers: fal (default), replicate, openai
 *
 * Configuration in app.json:
 *   "mediaGen": {
 *     "image": {
 *       "provider": "fal",          // "fal" | "replicate" | "openai"
 *       "model": "nano-banana-2",   // provider-specific model name
 *       "envKey": "FAL_KEY"         // env var holding the API key
 *     },
 *     "video": {
 *       "provider": "fal",
 *       "model": "veo3.1",
 *       "envKey": "FAL_KEY"
 *     }
 *   }
 *
 * Falls back to Fal.ai if not configured (backward compatible).
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const FAL_SCRIPT = path.join(__dirname, '..', 'fal', 'fal-generate.js');

// ── Provider: Fal.ai ──

async function falGenerateImage(prompt, outPath, aspectRatio = '9:16', opts = {}) {
  const key = process.env[opts.envKey || 'FAL_KEY'];
  if (!key) throw new Error(`${opts.envKey || 'FAL_KEY'} environment variable required for Fal.ai image generation`);

  const { TIMEOUTS } = require('./helpers');
  const args = ['image', '--prompt', prompt, '--aspect', aspectRatio, '--out', outPath, '--timeout', String(TIMEOUTS.imageGen - 10000)];
  if (opts.model) {
    const falModel = opts.model.startsWith('fal-ai/') ? opts.model : `fal-ai/${opts.model}`;
    args.push('--model', falModel);
  }

  console.log(`    📤 Fal.ai image gen (${opts.model || 'nano-banana-2'})...`);
  const result = execSync(
    `node ${JSON.stringify(FAL_SCRIPT)} ${args.map(a => JSON.stringify(a)).join(' ')}`,
    { env: { ...process.env, [opts.envKey || 'FAL_KEY']: key }, timeout: TIMEOUTS.imageGen, stdio: ['pipe', 'pipe', 'pipe'] }
  );

  const parsed = JSON.parse(result.toString().trim());
  if (!parsed.images?.length) throw new Error('Fal.ai returned no images');
  console.log(`    ✅ Image generated: ${parsed.request_id}`);
}

async function falGenerateVideo(prompt, outPath, durationSeconds = 8, opts = {}) {
  const key = process.env[opts.envKey || 'FAL_KEY'];
  if (!key) throw new Error(`${opts.envKey || 'FAL_KEY'} environment variable required for Fal.ai video generation`);

  // Clamp to valid durations
  const VALID_DURATIONS = [4, 8, 12];
  if (!VALID_DURATIONS.includes(durationSeconds)) {
    const clamped = VALID_DURATIONS.reduce((a, b) => Math.abs(b - durationSeconds) < Math.abs(a - durationSeconds) ? b : a);
    console.log(`   ⚠️ Duration ${durationSeconds}s not supported, clamping to ${clamped}s`);
    durationSeconds = clamped;
  }

  const { TIMEOUTS } = require('./helpers');
  const args = ['video', '--prompt', prompt, '--aspect', '9:16', '--duration', String(durationSeconds), '--out', outPath, '--timeout', String(TIMEOUTS.videoGen - 20000)];

  console.log(`   📤 Fal.ai video gen (${opts.model || 'veo3.1'}, ${durationSeconds}s)...`);
  const result = execSync(
    `node ${JSON.stringify(FAL_SCRIPT)} ${args.map(a => JSON.stringify(a)).join(' ')}`,
    { env: { ...process.env, [opts.envKey || 'FAL_KEY']: key }, timeout: TIMEOUTS.videoGen, stdio: ['pipe', 'pipe', 'pipe'] }
  );

  const parsed = JSON.parse(result.toString().trim());
  if (!parsed.video?.url) throw new Error('Fal.ai returned no video');
  console.log(`   ✅ Video generated: ${parsed.request_id}`);
  return outPath;
}

// ── Provider: Replicate ──

async function replicateGenerateImage(prompt, outPath, aspectRatio = '9:16', opts = {}) {
  const key = process.env[opts.envKey || 'REPLICATE_API_TOKEN'];
  if (!key) throw new Error(`${opts.envKey || 'REPLICATE_API_TOKEN'} required for Replicate image generation`);

  const model = opts.model || 'black-forest-labs/flux-schnell';
  console.log(`    📤 Replicate image gen (${model})...`);

  // Use Replicate HTTP API directly
  const createRes = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: { prompt, aspect_ratio: aspectRatio, output_format: 'png' },
    }),
  });
  if (!createRes.ok) throw new Error(`Replicate create failed: ${createRes.status} ${await createRes.text()}`);
  let prediction = await createRes.json();

  // Poll for completion
  const startTime = Date.now();
  while (!['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
    if (Date.now() - startTime > 120000) throw new Error('Replicate prediction timed out (120s)');
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await fetch(prediction.urls.get, { headers: { 'Authorization': `Bearer ${key}` } });
    prediction = await pollRes.json();
  }

  if (prediction.status !== 'succeeded') throw new Error(`Replicate prediction ${prediction.status}: ${prediction.error}`);

  const imageUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!imageUrl) throw new Error('Replicate returned no output');

  // Download image
  const imgRes = await fetch(imageUrl);
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  fs.writeFileSync(outPath, buffer);
  console.log(`    ✅ Image generated: ${prediction.id}`);
}

// ── Provider: OpenAI ──

async function openaiGenerateImage(prompt, outPath, aspectRatio = '9:16', opts = {}) {
  const key = process.env[opts.envKey || 'OPENAI_API_KEY'];
  if (!key) throw new Error(`${opts.envKey || 'OPENAI_API_KEY'} required for OpenAI image generation`);

  const model = opts.model || 'gpt-image-1';
  const size = aspectRatio === '1:1' ? '1024x1024' : '1024x1536';
  console.log(`    📤 OpenAI image gen (${model}, ${size})...`);

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, n: 1, size, response_format: 'b64_json' }),
  });
  if (!res.ok) throw new Error(`OpenAI image gen failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no image');

  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  console.log(`    ✅ Image generated`);
}

// ── Provider Registry ──

const IMAGE_PROVIDERS = {
  fal: falGenerateImage,
  replicate: replicateGenerateImage,
  openai: openaiGenerateImage,
};

const VIDEO_PROVIDERS = {
  fal: falGenerateVideo,
  // Replicate and OpenAI video gen can be added here
};

/**
 * Resolve the image generation function for an app.
 * Reads mediaGen.image from app.json, falls back to Fal.ai.
 *
 * @param {object} appConfig - App config from app.json
 * @returns {{ generate: Function, provider: string, model: string }}
 */
function resolveImageGen(appConfig) {
  const config = appConfig?.mediaGen?.image || {};
  const provider = config.provider || 'fal';
  const model = config.model || null;
  const envKey = config.envKey || null;

  const fn = IMAGE_PROVIDERS[provider];
  if (!fn) throw new Error(`Unknown image provider: ${provider}. Supported: ${Object.keys(IMAGE_PROVIDERS).join(', ')}`);

  return {
    generate: (prompt, outPath, aspectRatio = '9:16') => fn(prompt, outPath, aspectRatio, { model, envKey }),
    provider,
    model: model || (provider === 'fal' ? 'nano-banana-2' : provider === 'replicate' ? 'flux-schnell' : 'gpt-image-1'),
  };
}

/**
 * Resolve the video generation function for an app.
 * Reads mediaGen.video from app.json, falls back to Fal.ai.
 */
function resolveVideoGen(appConfig) {
  const config = appConfig?.mediaGen?.video || {};
  const provider = config.provider || 'fal';
  const model = config.model || null;
  const envKey = config.envKey || null;

  const fn = VIDEO_PROVIDERS[provider];
  if (!fn) throw new Error(`Unknown video provider: ${provider}. Supported: ${Object.keys(VIDEO_PROVIDERS).join(', ')}`);

  return {
    generate: (prompt, outPath, durationSeconds = 8) => fn(prompt, outPath, durationSeconds, { model, envKey }),
    provider,
    model: model || 'veo3.1',
  };
}

module.exports = {
  resolveImageGen,
  resolveVideoGen,
};
