#!/usr/bin/env node
/**
 * Shared Visual Post Creation Engine
 *
 * Consolidates the image generation → text overlay → JPEG compression →
 * Dropspace upload → publish pipeline used by TikTok, Instagram, and Facebook.
 *
 * Called directly via CLI with --app and --platform flags,
 * or programmatically via runCreateVisualPost(config).
 *
 * Config shape:
 * {
 *   platform: 'tiktok',
 *   defaultPlatforms: ['tiktok'],          // default --platforms value
 *   minMedia: 1,                           // minimum media for this platform (Instagram: 2)
 *   platformContentsExtra: (platform, caption, hook) => ({}),  // extra fields per platform_contents entry
 *   draftMessage: (launchId, hook, caption) => string,         // draft mode instructions
 *   postMetricFields: () => ({}),          // extra metric fields for posts.json entries
 * }
 */

const fs = require('fs');
const path = require('path');
const { dropspaceRequest: _dropspaceReq } = require('../core/api');
const { etTimestamp, loadJSON, saveJSON, parseArgs, recordFailure: _recordFailure, recordError: _recordError, buildUtmUrl, buildCta, resolveApiKey } = require('../core/helpers');
const { resolveAccounts, buildTikTokSettings, publishAndVerify, dequeueAndRecord } = require('../core/launch');
const pathsLib = require('../core/paths');
const { getPlatformDef } = require('../core/platforms');

function runCreateVisualPost(config) {
  const { getArg, hasFlag } = parseArgs();

  const platform = config.platform || getArg('platform');
  const appName = getArg('app');
  let hook = getArg('hook');
  const promptsPath = getArg('prompts');
  const textsPath = getArg('texts');
  let caption = getArg('caption');

  // Merge config with platform registry if called directly
  if (!config.defaultPlatforms && platform) {
    const platDef = getPlatformDef(platform);
    config = { ...platDef, ...config };
  }

  const platforms = (getArg('platforms') || config.defaultPlatforms.join(',')).split(',');
  const shouldPublish = hasFlag('publish');
  const draftMode = hasFlag('draft');
  const scheduledDate = getArg('schedule');
  const dryRun = hasFlag('dry-run');
  // Images are always generated on-demand (batch-prepare removed)
  const useNext = hasFlag('next');

  if (!appName || !platform || (!hook && !useNext) || (!textsPath && !useNext)) {
    console.error('Usage: node create-visual-post-engine.js --app <name> --platform <platform> --hook "..." --texts <texts.json>');
    console.error('  --next: auto-pick next hook from strategy.json postQueue');
    console.error('  --prompts: optional if queue entry has slidePrompts');
    process.exit(1);
  }

  const { DROPSPACE_URL } = require('../core/api');
  // resolveApiKey imported at top level
  const DROPSPACE_KEY = resolveApiKey(appName);
  if (!DROPSPACE_KEY) { console.error(`ERROR: Dropspace API key not set (check apiKeyEnv in app.json or set DROPSPACE_API_KEY)`); process.exit(1); }

  const appDir = pathsLib.platformDir(appName, platform);
  const appConfig = pathsLib.loadAppConfig(appName) || {};
  

  // Merge app.json platform overrides into config (e.g. tiktokPrivacyLevel)
  const appPlatConfig = appConfig.platforms?.[platform] || {};
  if (appPlatConfig.tiktokPrivacyLevel) config.tiktokPrivacyLevel = appPlatConfig.tiktokPrivacyLevel;
  const strategyFilePath = pathsLib.strategyPath(appName, platform);
  const strategy = loadJSON(strategyFilePath, {});

  // Blueprint data extracted from queue entries
  let blueprintSlideTexts = null;
  let blueprintSlidePrompts = null;
  const { resolveDefaultFormat } = require('../core/formats');
  let postFormat = resolveDefaultFormat(appName, platform); // resolved from posting history

  // ── Scene anchor for locked-architecture formats ──
  let sceneAnchor = null;
  let slideMoods = null;

  // --next: auto-pick from postQueue
  if (useNext && !hook) {
    if (!strategy.postQueue || strategy.postQueue.length === 0) {
      console.error('ERROR: --next specified but postQueue is empty in strategy.json');
      process.exit(1);
    }
    const nextEntry = strategy.postQueue.find(h => !(h.text || h).startsWith('[AGENT:'));
    if (!nextEntry) { console.error('ERROR: no usable posts in postQueue'); process.exit(1); }
    hook = nextEntry.text || nextEntry;
    if (nextEntry.slideTexts) {
      console.log(`📋 Blueprint found — using pre-generated slide texts + caption`);
      blueprintSlideTexts = nextEntry.slideTexts;
      if (nextEntry.caption && !caption) caption = nextEntry.caption;
      if (nextEntry.slidePrompts) blueprintSlidePrompts = nextEntry.slidePrompts;
    }
    if (nextEntry.sceneAnchor) sceneAnchor = nextEntry.sceneAnchor;
    if (nextEntry.slideMoods) slideMoods = nextEntry.slideMoods;
    if (nextEntry.format) postFormat = nextEntry.format;
    console.log(`🎣 Auto-picked post from queue: "${hook}"`);
  }

  // When --hook is passed directly, look up blueprint from queue
  if (hook && !useNext) {
    const hookLower = hook.toLowerCase();
    const queueEntry = (strategy.postQueue || []).find(h => (h.text || '').toLowerCase() === hookLower);
    if (queueEntry && queueEntry.slideTexts) {
      console.log(`📋 Blueprint found in queue — using pre-generated slide texts + caption`);
      blueprintSlideTexts = queueEntry.slideTexts;
      if (queueEntry.caption && !caption) caption = queueEntry.caption;
      if (queueEntry.slidePrompts) blueprintSlidePrompts = queueEntry.slidePrompts;
    }
    if (queueEntry?.sceneAnchor) sceneAnchor = queueEntry.sceneAnchor;
    if (queueEntry?.slideMoods) slideMoods = queueEntry.slideMoods;
    if (queueEntry && queueEntry.format) postFormat = queueEntry.format;
  }

  // Check for pre-sourced images (e.g. from Drive via clipper slideshow)
  let preSourcedImages = null;
  {
    const entry = useNext
      ? (strategy.postQueue || []).find(h => !(h.text || h).startsWith('[AGENT:'))
      : (strategy.postQueue || []).find(h => (h.text || '').toLowerCase() === (hook || '').toLowerCase());
    if (entry && entry.imagePaths && Array.isArray(entry.imagePaths)) {
      preSourcedImages = entry.imagePaths;
      console.log(`📷 Using ${preSourcedImages.length} pre-sourced images (imageSource: ${entry.imageSource || 'external'})`);
    }
  }

  // Determine expected slide count from format (needed before prompt selection)
  const { FORMATS } = require('../core/formats');
  const formatDef = FORMATS[postFormat];
  let expectedSlides = formatDef?.slides || 6;

  // Load prompts: LLM slidePrompts or prompts file
  let prompts;

  if (preSourcedImages) {
    // Pre-sourced images — no generation needed, use dummy prompts
    prompts = { base: '', slides: preSourcedImages.map(() => ''), llmControlled: true };
  } else if (sceneAnchor && slideMoods && formatDef?.usesSceneAnchor) {
    // ── Locked Architecture: sceneAnchor + slideMoods ──
    // Construct full prompts: anchor + mood + suffix for each slide.
    // This structurally enforces visual consistency across all slides.
    const suffix = formatDef.promptSuffix || '';
    const contentSlides = formatDef?.ctaSlide ? expectedSlides - 1 : expectedSlides;
    const MAX_PROMPT_CHARS = 1990;
    const constructedPrompts = [];
    for (let i = 0; i < contentSlides; i++) {
      const mood = slideMoods[i] || '';
      let full = `${sceneAnchor}\n\n${mood}\n\n${suffix}`;
      if (full.length > MAX_PROMPT_CHARS) {
        // Truncate sceneAnchor to fit — mood and suffix are more important per-slide
        const overhead = mood.length + suffix.length + 6; // 6 for newlines
        const maxAnchor = MAX_PROMPT_CHARS - overhead;
        const truncAnchor = sceneAnchor.substring(0, maxAnchor);
        full = `${truncAnchor}\n\n${mood}\n\n${suffix}`;
        console.warn(`  ⚠️ Slide ${i + 1} prompt truncated (${sceneAnchor.length}→${maxAnchor} anchor chars) to fit 2000 char limit`);
      }
      constructedPrompts.push(full);
    }
    console.log(`🔒 Locked architecture: sceneAnchor (${sceneAnchor.length} chars) + ${slideMoods.length} moods`);
    prompts = {
      base: '',
      slides: constructedPrompts,
      llmControlled: true,
    };
  } else if (blueprintSlidePrompts && blueprintSlidePrompts.length > 0) {
    // Fallback: independent slidePrompts (legacy, non-locked)
    const contentSlides = formatDef?.ctaSlide ? expectedSlides - 1 : expectedSlides;
    if (blueprintSlidePrompts.length !== contentSlides && blueprintSlidePrompts.length !== expectedSlides) {
      console.warn(`  ⚠️ slidePrompts count (${blueprintSlidePrompts.length}) doesn't match expected (${contentSlides} content + ${formatDef?.ctaSlide ? '1 CTA' : '0 CTA'}). Proceeding anyway.`);
    }
    if (formatDef?.usesSceneAnchor) {
      console.warn(`  ⚠️ Format "${postFormat}" expects sceneAnchor+slideMoods but got slidePrompts. Visual consistency may suffer.`);
    }
    console.log(`🎨 Using LLM-generated slide prompts (${blueprintSlidePrompts.length} prompts for format "${postFormat}")`);
    prompts = {
      base: '',
      slides: blueprintSlidePrompts,
      llmControlled: true,
    };
  } else if (promptsPath) {
    prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf-8'));
  } else {
    console.error('🎨 No slidePrompts — cannot generate images. Queue entries must have slidePrompts array.');
    process.exit(1);
  }

  const texts = textsPath
    ? JSON.parse(fs.readFileSync(textsPath, 'utf-8'))
    : blueprintSlideTexts;
  if (!texts) { console.error('ERROR: No texts provided (--texts or blueprint slideTexts)'); process.exit(1); }

  // Content slides = total - CTA (if applicable). Engine generates CTA slide/prompt separately.
  const contentSlideCount = formatDef?.ctaSlide ? expectedSlides - 1 : expectedSlides;
  if (!prompts.slides || (prompts.slides.length !== expectedSlides && prompts.slides.length !== contentSlideCount)) {
    console.error(`ERROR: prompts must have ${contentSlideCount} content slides (or ${expectedSlides} total) for format "${postFormat}" (got ${prompts.slides?.length || 0})`);
    process.exit(1);
  }
  if (texts.length !== expectedSlides && texts.length !== contentSlideCount) {
    console.error(`ERROR: texts must have ${contentSlideCount} content entries (or ${expectedSlides} total) for format "${postFormat}" (got ${texts.length})`);
    process.exit(1);
  }

  // ── CTA Slide ──
  // ctaSlide is controlled per-format in FORMATS registry.
  // true = engine generates CTA slide (image prompt auto-derived, text auto-appended if missing).
  // false = no CTA image slide. CTA goes in caption only.
  // Caption CTA is always appended regardless (handled by buildCta in platform_contents).
  
  // Auto-append CTA text if LLM only provided content slide texts (not CTA text)
  if (formatDef?.ctaSlide && texts.length === contentSlideCount) {
    const ctaText = (appConfig.cta?.[platform] || appConfig.cta?.default || appConfig.url || 'try it now').replace(/\s*→.*/, '');
    const ctaUrl = (appConfig.url || '').replace(/^https?:\/\//, '');
    texts.push(ctaUrl ? `${ctaText}\n${ctaUrl}` : ctaText);
    console.log(`  📝 Auto-appended CTA slide text (texts now ${texts.length})`);
  }

  if (formatDef && formatDef.ctaSlide === false) {
    console.log(`  ⏭ No CTA slide for ${postFormat} format (caption CTA only)`);
  }

  // Failures (content rules) vs Errors (transient API issues)
  const failuresPath = pathsLib.failuresPath(appName, platform);
  function recordFailure(rule, context = {}) {
    _recordFailure(failuresPath, rule, context);
  }
  function recordError(error, context = {}) {
    _recordError(appName, platform, error, context);
  }

  if (fs.existsSync(failuresPath)) {
    const failures = JSON.parse(fs.readFileSync(failuresPath, 'utf-8'));
    if (failures.failures?.length > 0) {
      console.log(`\n⚠️  Checking ${failures.failures.length} failure rules...`);
      for (const f of failures.failures) console.log(`  📌 ${f.rule}`);
      console.log('');
    }
  }

  // Output directory
  const timestamp = etTimestamp(new Date());
  const postDir = pathsLib.postAssetsDir(appName, platform, timestamp);
  fs.mkdirSync(postDir, { recursive: true });

  // ── Image generation (provider from app.json mediaGen, defaults to Fal.ai) ──
  const { resolveImageGen } = require('../core/media-gen');
  const imageGen = resolveImageGen(appConfig);
  const generateImage = imageGen.generate;

  async function withRetry(fn, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try { return await fn(); }
      catch (e) {
        if (attempt < retries) {
          console.log(`  ⚠️ ${e.message}. Retrying (${attempt + 1}/${retries})...`);
          await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
        } else throw e;
      }
    }
  }

  // ── Canvas / text overlay setup ──
  // Overlay rendering uses the shared module (overlay.js).
  // Raw canvas access retained for image resize/crop.
  const overlayModule = require('../core/overlay');
  const canvasModule = overlayModule.initCanvas();
  const { wrapText } = overlayModule;

  // Overlay function delegates to shared module with format-specific style from FORMATS registry
  const { FORMATS: _FORMATS } = require('../core/formats');
  async function addOverlay(imgPath, text, outPath, slideIndex) {
    const formatStyle = _FORMATS[postFormat]?.overlayStyle || null;
    return overlayModule.addOverlay(imgPath, text, outPath, {
      style: formatStyle,
      preset: formatStyle ? undefined : postFormat,
      slideIndex,
    });
  }

  // Dropspace API wrapper
  async function dropspaceAPI(method, endpoint, body = null) {
    return _dropspaceReq(method, endpoint, body, DROPSPACE_KEY);
  }

  // ── MAIN ──
  (async () => {
    console.log(`\n🎬 Creating ${platform} post for ${appName}`);
    console.log(`   Hook: "${hook}"`);
    console.log(`   Platforms: ${platforms.join(', ')}`);
    console.log(`   Model: ${imageGen.model} via ${imageGen.provider}`);
    console.log(`   Output: ${postDir}\n`);

    if (dryRun) console.log('🏃 Dry run — will generate images and overlays but not upload or publish.\n');

    // ── Step 1: Generate images ──
    console.log(`📸 Step 1: Generating ${expectedSlides} images (format: ${postFormat})...\n`);

    console.log(`  🎨 Using ${imageGen.provider} (${imageGen.model})`);

    // If pre-sourced images (from Drive/clipper), copy them as raw slides and skip all generation
    if (preSourcedImages) {
      console.log(`  📷 Copying ${preSourcedImages.length} pre-sourced images...\n`);
      for (let i = 0; i < Math.min(preSourcedImages.length, expectedSlides); i++) {
        const src = preSourcedImages[i];
        const outPath = path.join(postDir, `slide${i + 1}_raw.png`);
        if (!fs.existsSync(src)) {
          console.error(`  ❌ Missing source image: ${src}`);
          process.exit(1);
        }
        // Resize/crop to target dimensions using canvas
        const srcImg = await canvasModule.loadImage(src);
        const targetW = 1024, targetH = 1536; // 9:16 vertical
        const canvas = canvasModule.createCanvas(targetW, targetH);
        const ctx = canvas.getContext('2d');
        // Cover crop — fill target, center crop overflow
        const scale = Math.max(targetW / srcImg.width, targetH / srcImg.height);
        const sw = targetW / scale, sh = targetH / scale;
        const sx = (srcImg.width - sw) / 2, sy = (srcImg.height - sh) / 2;
        ctx.drawImage(srcImg, sx, sy, sw, sh, 0, 0, targetW, targetH);
        fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
        console.log(`  ✅ slide${i + 1}_raw.png (from ${path.basename(src)})`);
      }
      // Skip to overlay step
    } else {

      const slidePrompts = [], slideOutPaths = [], slideIndices = [];
      for (let i = 0; i < expectedSlides; i++) {
        const outPath = path.join(postDir, `slide${i + 1}_raw.png`);
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
          console.log(`  ⏭ slide${i + 1}_raw.png exists, skipping`);
          continue;
        }
        let fullPrompt;
        if (i < prompts.slides.length) {
          // Content slide — use LLM prompt or base+slide
          fullPrompt = prompts.llmControlled
            ? prompts.slides[i]
            : `${prompts.base}\n\n${prompts.slides[i]}`;
        } else {
          // CTA slide — derive from last content slide (darkened/muted variant)
          const lastContentPrompt = prompts.slides[prompts.slides.length - 1] || '';
          const ctaSuffix = ' The scene is slightly darkened and muted, with a subtle warm glow suggesting resolution and a call to action. Minimal text space at center.';
          fullPrompt = `${lastContentPrompt}${ctaSuffix}`;
          if (fullPrompt.length > 1990) {
            fullPrompt = lastContentPrompt.substring(0, 1990 - ctaSuffix.length) + ctaSuffix;
          }
          console.log(`  🎨 Auto-generating CTA slide prompt from last content slide`);
        }
        // Validate: slidePrompts must describe visuals only — never text/copy/words
        // Strip the promptSuffix before checking — it contains meta-instructions about NOT
        // generating text (e.g. "no text, words...in the image") which false-positive the regex.
        const promptWithoutSuffix = formatDef?.promptSuffix
          ? fullPrompt.replace(formatDef.promptSuffix, '').trim()
          : fullPrompt;
        const textPatterns = /\b(text|words?|copy|says?|reads?|written|caption|headline|title|slogan|tagline|font|typography)\b.*\b(on|in|over|across|above|below)\b/i;
        if (textPatterns.test(promptWithoutSuffix)) {
          console.warn(`  ⚠️ Slide ${i+1} prompt contains text/copy instructions — stripping. Prompts must describe visuals only.`);
          fullPrompt = fullPrompt.replace(/\b(with |containing |showing |displaying |featuring )?(text|words?|copy|caption|headline|title|slogan|tagline)[\s:]+["']?[^.,"'\n]*["']?[.,]?/gi, '').trim();
        }
        slidePrompts.push(fullPrompt);
        slideOutPaths.push(outPath);
        slideIndices.push(i);
      }

      if (slidePrompts.length === 0) {
        console.log('  All slides already generated.\n');
      } else {
        console.log(`  🔄 Generating ${slidePrompts.length} slides realtime...\n`);
        const CONCURRENCY = 3;
        for (let batch = 0; batch < slidePrompts.length; batch += CONCURRENCY) {
          const genPromises = [];
          for (let j = 0; j < Math.min(CONCURRENCY, slidePrompts.length - batch); j++) {
            const idx = batch + j;
            const slideNum = slideIndices[idx] + 1;
            console.log(`  Generating slide ${slideNum}...`);
            genPromises.push(
              withRetry(async () => {
                await generateImage(slidePrompts[idx], slideOutPaths[idx]);
              })
                .then(() => console.log(`  ✅ slide${slideNum}_raw.png`))
                .catch(e => { console.error(`  ❌ Slide ${slideNum} failed: ${e.message}`); throw e; })
            );
          }
          try { await Promise.all(genPromises); }
          catch { console.error(`\n  Re-run to retry — completed slides are preserved.`); process.exit(1); }
        }
      }
    } // end else (not preSourcedImages)

    // ── Step 2: Text overlays ──
    console.log('\n📝 Step 2: Adding text overlays...\n');
    for (let i = 0; i < expectedSlides; i++) {
      const rawPath = path.join(postDir, `slide${i + 1}_raw.png`);
      const outPath = path.join(postDir, `slide${i + 1}.png`);
      
      if (!fs.existsSync(rawPath)) { console.error(`  ❌ Missing: ${rawPath}`); process.exit(1); }
      // Skip overlay if text is empty (pre-sourced images with no text)
      if (!texts[i] || !texts[i].trim()) {
        fs.copyFileSync(rawPath, outPath);
        console.log(`  ✅ slide${i + 1}.png — no overlay (raw image)`);
        continue;
      }
      const lines = await addOverlay(rawPath, texts[i], outPath, i);
      console.log(`  ✅ slide${i + 1}.png — ${lines.length} lines (${postFormat} style)`);
    }

    // ── Step 2.5: Validate generated images ──
    console.log('\n🔍 Validating slides...\n');
    let validationFailed = false;
    for (let i = 1; i <= expectedSlides; i++) {
      const overlayPath = path.join(postDir, `slide${i}.png`);
      const rawPath = path.join(postDir, `slide${i}_raw.png`);
      const stat = fs.statSync(overlayPath);
      const rawStat = fs.statSync(rawPath);

      // Check file size (raw image should be >10KB, overlay should be >10KB)
      if (rawStat.size < 10000) {
        console.error(`  ❌ slide${i}_raw.png is suspiciously small (${(rawStat.size / 1024).toFixed(1)}KB) — likely corrupted`);
        validationFailed = true;
        continue;
      }

      // Check dimensions via canvas
      const checkImg = await canvasModule.loadImage(overlayPath);
      if (checkImg.width < 512 || checkImg.height < 512) {
        console.error(`  ❌ slide${i}.png has wrong dimensions: ${checkImg.width}×${checkImg.height} (expected ~1024×1536)`);
        validationFailed = true;
        continue;
      }

      // Aspect ratio check (should be roughly 2:3 portrait)
      const ratio = checkImg.height / checkImg.width;
      if (ratio < 1.2 || ratio > 1.8) {
        console.warn(`  ⚠️ slide${i}.png has unusual aspect ratio: ${ratio.toFixed(2)} (expected ~1.5)`);
      }

      console.log(`  ✅ slide${i}.png — ${checkImg.width}×${checkImg.height}, ${(stat.size / 1024).toFixed(0)}KB`);
    }
    if (validationFailed) {
      console.error('\n❌ Image validation failed — aborting to prevent posting broken images.');
      console.error('   Re-run to regenerate failed slides (completed slides are preserved).');
      recordFailure('Image validation failed: corrupted or wrong-dimension slides', { hook });
      process.exit(1);
    }

    if (dryRun) { console.log(`\n✨ Dry run complete. Images in ${postDir}`); process.exit(0); }

    // ── Step 3: Compress + create launch ──
    console.log('\n📦 Compressing slides to JPEG...\n');
    const media = [];
    for (let i = 1; i <= expectedSlides; i++) {
      const pngPath = path.join(postDir, `slide${i}.png`);
      const jpgPath = path.join(postDir, `slide${i}.jpg`);
      const img = await canvasModule.loadImage(pngPath);
      const canvas = canvasModule.createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const jpgBuffer = canvas.toBuffer('image/jpeg', { quality: 0.70 });
      fs.writeFileSync(jpgPath, jpgBuffer);
      console.log(`  ✅ slide${i}.jpg — ${(jpgBuffer.length / 1024).toFixed(0)}KB (was ${(fs.statSync(pngPath).size / 1024).toFixed(0)}KB PNG)`);
      media.push({ source: 'base64', data: jpgBuffer.toString('base64'), filename: `slide${i}.jpg`, mime_type: 'image/jpeg' });
    }

    // Clean up raw PNGs and overlay PNGs (JPGs + Dropspace URLs are the source of truth now)
    for (let i = 1; i <= expectedSlides; i++) {
      const rawPath = path.join(postDir, `slide${i}_raw.png`);
      const pngPath = path.join(postDir, `slide${i}.png`);
      try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch {}
      try { if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath); } catch {}
    }
    console.log(`  🧹 Cleaned up ${expectedSlides * 2} PNG files (JPGs + Dropspace URLs are source of truth)`);

    // Minimum media check (Instagram needs ≥ 2)
    const minMedia = config.minMedia || 1;
    if (media.length < minMedia) {
      console.error(`❌ ${platform} requires ≥ ${minMedia} images, only ${media.length} generated`);
      recordFailure(`${platform} requires ≥ ${minMedia} images, only ${media.length} generated`, { hook });
      process.exit(1);
    }

    // Idempotency check
    const today = new Date().toISOString().slice(0, 10);
    try {
      const existingRes = await dropspaceAPI('GET', '/launches?page_size=50');
      const duplicate = existingRes.data?.find(l =>
        (l.name || "").toLowerCase().trim() === hook.toLowerCase().trim() &&
        l.created_at?.startsWith(today) &&
        l.platforms?.includes(platforms[0]) &&
        !['cancelled', 'failed'].includes(l.status)
      );
      if (duplicate) {
        console.log(`\n⚠️ Launch already exists for this hook today: ${duplicate.id} (${duplicate.status})`);
        console.log('Skipping to avoid duplicate. Use --force to override.');
        if (!hasFlag('force')) process.exit(0);
      }
    } catch (e) { console.warn('  ⚠️ Could not check for duplicates:', e.message); }

    // Build platform_contents
    const cta = buildCta(config, appConfig, platform);
    const platformContents = {};
    for (const p of platforms) {
      // Append CTA with UTM link to caption text
      let contentText = caption || hook;
      if (cta && cta.text) {
        const utmUrl = buildUtmUrl(appConfig, p);
        const ctaLine = utmUrl || cta.text;
        const appDomain = (appConfig.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
        if (!appDomain || !contentText.toLowerCase().includes(appDomain)) {
          contentText = contentText.trimEnd() + '\n\n' + ctaLine;
        }
      }
      const entry = { content: contentText };
      if (p === 'reddit') entry.title = hook;
      if (p === 'tiktok') {
        entry.tiktok_settings = buildTikTokSettings(appPlatConfig, config.tiktokPrivacyLevel);
      }
      // Platform-specific extras
      if (config.platformContentsExtra) {
        Object.assign(entry, config.platformContentsExtra(p, caption, hook));
      }
      platformContents[p] = entry;
    }

    console.log('\n🚀 Creating Dropspace launch...\n');

    // Resolve user_platform_accounts from app.json connectionIds
    const { userPlatformAccounts, dropspacePlatforms } = resolveAccounts(appConfig, platforms);

    const launchBody = {
      title: hook,
      product_description: appConfig.description || '',
      platforms,
      product_url: buildUtmUrl(appConfig, platform) || appConfig.url || null,
      media,
      media_attach_platforms: platforms,
      media_mode: 'images',
      platform_contents: platformContents,
    };
    if (Object.keys(userPlatformAccounts).length > 0) {
      launchBody.user_platform_accounts = userPlatformAccounts;
    }
    if (dropspacePlatforms.length > 0) {
      launchBody.dropspace_platforms = dropspacePlatforms;
    }
    if (scheduledDate) {
      launchBody.scheduled_date = scheduledDate;
      console.log(`  📅 Scheduled for: ${scheduledDate}`);
    }

    const launchRes = await dropspaceAPI('POST', '/launches', launchBody);
    if (launchRes.error || !launchRes.data?.id) {
      const errMsg = launchRes.error?.message || launchRes.error?.code || 'Launch creation failed';
      console.error(`  ❌ Launch creation failed: ${errMsg}`);
      recordError(`Launch creation failed: ${errMsg}`, { hook });
      process.exit(1);
    }
    const launchId = launchRes.data.id;
    console.log(`  ✅ Launch created: ${launchId}`);

    // ── Step 4: Publish / Schedule ──
    if (scheduledDate) {
      console.log(`\n📅 SCHEDULED — Launch ${launchId} will publish at ${scheduledDate}`);
      console.log(`   Dashboard: https://www.dropspace.dev/launches/${launchId}`);
    } else if (shouldPublish && !draftMode) {
      try {
        await publishAndVerify(DROPSPACE_KEY, launchId, platform, recordError);
      } catch (e) {
        process.exit(1);
      }
    } else if (draftMode) {
      if (config.draftMessage) {
        console.log(config.draftMessage(launchId, hook, caption));
      } else {
        console.log(`\n📋 DRAFT MODE — Launch ${launchId} ready for publishing`);
      }
    } else {
      console.log(`\n📋 Launch created as draft. Publish with:`);
      console.log(`   curl -X POST ${DROPSPACE_URL}/launches/${launchId}/publish -H "Authorization: Bearer $DROPSPACE_API_KEY"`);
    }

    // Dequeue, update posts.json, save meta.json
    const postsPath = pathsLib.postsPath(appName, platform);
    dequeueAndRecord(appName, platform, hook, launchId, postFormat, {
      caption: caption || null,
      slideTexts: texts || null,
      slidePrompts: blueprintSlidePrompts || null,
      ...(config.postMetricFields ? config.postMetricFields() : {}),
    }, strategyFilePath, postsPath);

    // Save post metadata
    const meta = {
      launchId, app: appName, hook,
      format: postFormat,
      caption: caption || '(AI-generated)',
      platforms, model: `${imageGen.provider}/${imageGen.model}`,
      published: shouldPublish && !draftMode,
      createdAt: new Date().toISOString(),
      postDir,
      ...(sceneAnchor ? { sceneAnchor } : {}),
      ...(slideMoods ? { slideMoods } : {}),
      slidePrompts: blueprintSlidePrompts || null,
    };
    fs.writeFileSync(path.join(postDir, 'meta.json'), JSON.stringify(meta, null, 2));

    console.log(`\n✨ Done! Launch ID: ${launchId}`);
  })().catch(async (e) => {
    console.error(`\n❌ Fatal: ${e.message}`);
    process.exit(1);
  });
}

// CLI entrypoint — run directly with: node create-visual-post-engine.js --app X --platform Y [--next] [--schedule ISO]
if (require.main === module) {
  runCreateVisualPost({});
}

module.exports = { runCreateVisualPost };
