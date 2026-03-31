/**
 * Format registry for the automation pipeline.
 *
 * Defines all content formats across three generator types:
 *   - AI-generated: ai-visual (story-slideshow), ai-text (text-post, text-single),
 *                   ai-video (ugc-reaction)
 *   - Drive-sourced: drive-photos (photo-slideshow), drive-clips (video-clip)
 *   - Manual: manual (manual-text) — pre-written content queued by user
 *
 * Also provides experiment lifecycle management (activate, kill, graduate)
 * with LLM-driven strategic decisions.
 *
 * Data lives at: {DATA_ROOT}/{app}/{platform}/experiments.json (see paths.js)
 */

const fs = require('fs');
const path = require('path');
const { loadJSON, saveJSON } = require('./helpers');
const paths = require('./paths');

// ── Format Registry ─────────────────────────────────────────────
// All known content formats. Each format has a `generator` field that determines
// which creation engine handles it:
//   'ai-visual'    → create-visual-post-engine.js (image gen + overlays)
//   'ai-text'      → create-text-post-engine.js (LLM-generated text)
//   'ai-video'     → create-video-post-engine.js (Veo 3.1 + FFmpeg)
//   'drive-photos' → create-slideshows.js (photos from Google Drive)
//   'drive-clips'  → clipper skill (video clips from Drive footage)
//   'manual'       → no engine (content pre-written, queued directly)

// ── Format → Platform Allowlist ─────────────────────────────────
// Which formats are allowed on which platforms. Source of truth.
const FORMAT_PLATFORMS = {
  // Pre-configured (platform assignment comes from app.json, not hardcoded here)
  'photo-slideshow':    ['tiktok', 'instagram'],
  'video-clip':         ['tiktok', 'instagram'],
  'manual-text':        ['twitter', 'linkedin', 'facebook', 'reddit'],
  // AI Visual
  'story-slideshow':              ['tiktok', 'instagram', 'facebook'],
  // AI Text
  'text-post':          ['facebook', 'linkedin', 'reddit'],
  'text-single':        ['twitter'],
  // AI Video
  'ugc-reaction':       ['tiktok', 'instagram'],
  'ugc-talking':        ['tiktok', 'instagram'],
};

const FORMATS = {
  // ── Visual formats (TikTok, Instagram) ──────────────────────
  // Product context comes from product.* in POSTS_NEEDED (name, description, audience, problem).
  // Format descriptions are product-agnostic — the LLM adapts them to the specific product.

  // ── Pre-configured formats (no AI generation) ─────────────
  'photo-slideshow': {
    type: 'visual',
    generator: 'drive-photos',
    description: 'Photo slideshow from Google Drive folder. Downloads photos, resizes, applies text overlays (hook → context → CTA), uploads as multi-image post. LLM generates overlay texts using CONTEXT.md for community/event context. Persona generates captions. Used by manual apps with photo libraries (e.g. community event photos).',
    imageGen: false,
    textOverlay: true,
    overlayStyle: { position: 'center', fontScale: 'large', stroke: true, fill: '#FFFFFF', strokeColor: '#000000', bg: 'rgba(0, 0, 0, 0.45)', bgPadding: 0.04 },
    config: {
      photosPerSlideshow: 3,
      mixFolders: true,       // mix photos across subfolders
      resizeWidth: 1080,      // resize before upload
      resizeQuality: 85,      // JPEG quality
    },
  },
  'video-clip': {
    type: 'video',
    generator: 'drive-clips',
    description: 'Video clip extracted from longer footage via audio peak detection + FFmpeg. Source footage from Google Drive. Used for live performances, events, highlights.',
    imageGen: false,
    textOverlay: false,
    videoGen: false,  // not AI-generated — clipped from real footage
    config: {
      clipDuration: 30,
      cropMode: 'center',
    },
  },
  'manual-text': {
    type: 'text',
    generator: 'manual',
    description: 'Pre-written text content queued directly by the user. No AI generation — content is provided as-is. Used for personal brand posts where voice authenticity matters.',
  },

  // ── AI-generated formats ──────────────────────────────────
  // Format descriptions are PRODUCT-AGNOSTIC. Product context comes from
  // product.* in POSTS_NEEDED (name, description, audience, problem, differentiator).

  'story-slideshow': {
    type: 'visual',
    generator: 'ai-visual',
    description: 'Storytelling carousel — 6 slides with LOCKED ARCHITECTURE. One obsessively detailed scene shared across all slides. Only the mood/lighting/emotion changes. This is what makes transformations feel REAL.',
    slides: 6,
    ctaSlide: true,
    imageGen: true,
    textOverlay: true,
    // ── Locked Architecture: sceneAnchor + slideMoods ──
    // LLM generates ONE scene anchor (the physical room/person) and 5 mood deltas.
    // Engine constructs full prompts: sceneAnchor + slideMood + promptSuffix.
    // This structurally prevents the "every slide is a different room" failure.
    usesSceneAnchor: true,
    slideStructure: [
      'QUEUE ENTRY FORMAT (story-slideshow uses sceneAnchor, NOT slidePrompts):',
      '  sceneAnchor: ONE obsessively detailed scene description (150-300 words).',
      '    Describe: room dimensions (e.g. "12×14 foot room"), wall color, floor type,',
      '    ceiling height, window count + positions + curtain type, door location,',
      '    desk material + size + what\'s on it, chair type, monitor/laptop position,',
      '    other furniture, decorative objects, camera angle + height + distance,',
      '    person description (age, gender, build, clothing, hair). This scene is',
      '    COPIED IDENTICALLY into every slide prompt. Nothing in this description changes.',
      '',
      '  slideMoods: array of 5 strings (content slides only — CTA auto-generated):',
      '    Each mood describes ONLY what changes from the anchor: body posture,',
      '    facial expression, lighting conditions, time of day through windows,',
      '    which devices are on/off, emotional state. ~30-60 words each.',
      '',
      '  Slide 1 (HOOK): Frustrated, overwhelmed. Head in hands or gripping hair.',
      '    Multiple device screens casting harsh multi-colored light. Desk lamp off.',
      '    Late night — dark outside windows.',
      '  Slide 2 (PROBLEM): Slumped back in chair, exhausted. Phone, tablet, laptop',
      '    all glowing but screens facing away. Clock on wall showing late hour.',
      '    Darker, more stressed. The visual weight of doing too much.',
      '  Slide 3 (DISCOVERY): Sitting up straighter, leaning toward laptop. Warm',
      '    golden light from screen on face. Slight eyebrow lift. Desk lamp now on.',
      '    A moment of intrigue and hope.',
      '  Slide 4 (TRANSFORMATION): Relaxed lean back, slight smile. Single calm',
      '    blue-white glow from monitor. Extra devices gone — just one clean setup.',
      '    Morning light through windows, warm and hopeful.',
      '  Slide 5 (RESULT): Away from desk doing something they love (guitar, reading,',
      '    looking out window). Laptop in background still open with soft glow.',
      '    Golden hour light flooding the room. The product works while they live.',
      '  CTA (auto): Same room, empty. Person has left. Laptop still glowing, coffee',
      '    half-finished, chair pushed back. Peaceful, quiet, golden hour. Darker/muted',
      '    so white text overlay is readable.',
    ].join('\n'),
    overlayStyle: { position: 'upper-third', fontScale: 'fixed-6.5', stroke: true, fill: '#FFFFFF', strokeColor: '#000000', bg: null },
    promptSuffix: 'Photorealistic, cinematic lighting, portrait orientation 1024x1536. Absolutely no text, words, letters, labels, or UI elements anywhere in the image. Screens must face away from camera or show only as colored light/glow on the person\'s face.',
    promptRules: 'ABSOLUTE RULE: NO TEXT, WORDS, LETTERS, NUMBERS, LABELS, OR UI ELEMENTS IN ANY IMAGE. Screens must face away from camera or be shown only as colored light/glow on the person\'s face. Never describe what\'s ON a screen — describe the LIGHT it casts and the EMOTION on the person\'s face. The sceneAnchor is the physical truth — it never changes. slideMoods describe ONLY emotional/lighting deltas. Be obsessively specific in the anchor. Vary the person/room across different posts (don\'t always use the same founder archetype), but within a single post, the scene is locked.',
  },
  // ── Text formats ────────────────────────────────────────────
  'text-post': {
    type: 'text',
    generator: 'ai-text',
    description: 'Standard text post about the product — the problem it solves and how. Must be specifically about the product (see product.* in POSTS_NEEDED), not generic advice.',
  },
  'text-single': {
    type: 'text',
    generator: 'ai-text',
    description: 'Single long-form tweet (Twitter Premium, up to 25K chars). Write as one cohesive post — NOT a thread. Story arc: hook → insight/story → actionable takeaway → CTA. Use line breaks for readability. No 🧵 emoji. Think LinkedIn-post energy but with Twitter voice.',
  },

  // ── Video formats (TikTok, Instagram — not yet activated) ───
  'ugc-reaction': {
    type: 'video',
    generator: 'ai-video',
    ctaSlide: false,
    description: 'UGC Reaction + Demo format. Two-part video stitched via FFmpeg: (1) 4s AI-generated UGC-style selfie clip (Veo 3.1) — person reacting with frustration to the pain point. Raw, TikTok-native feel. Then your real product demo clip (configured in app.json). Demo IS the CTA. Caption handles the link. Requires demoClip config.',
    slides: 0,
    imageGen: false,
    textOverlay: false,
    videoGen: true,
    videoType: 'video',
    reactionDurationSeconds: 4,
    noAudio: true, // User swaps in trending music manually — strip all audio from output
    // Prompt guidance for the 4s reaction clip (Veo 3.1 text-to-video)
    // UGC = User Generated Content. Looks like a real person filming themselves on their phone.
    // Front-facing camera, selfie angle, casual/raw, no production value, TikTok-native feel.
    // NOT cinematic. NOT polished. NOT metaphorical. Raw, authentic, handheld.
    promptGuidance: 'The videoPrompt is a short, direct description of a person and their physical action/expression, shot from a selfie angle. Write it like you\'re describing exactly what you see on screen. Examples: "realistic video of blonde girl sitting in the passenger seat of her car. the camera angle should be from the perspective of a selfie as if she was taking her own photo", "girl leaning in and smiling at the camera", "man smiles at camera, then frowns, then laughs, then scrunches his face in disgust. he is inside a lavishly furnished apartment", "boy is staring and leaning into the camera, smirking. the camera is still". The person should look frustrated, exasperated, or overwhelmed — reactions that fit the pain described in product.problem. Keep it simple and physical. No metaphors, no abstract descriptions. Portrait 9:16. Keep prompt under 300 chars.',
  },
  'ugc-talking': {
    type: 'video',
    generator: 'ai-video',
    ctaSlide: false,
    description: 'UGC Talking-to-Camera + Demo format. Two-part video stitched via FFmpeg: (1) 8s AI-generated clip of a person talking to camera about the pain point — the prompt MUST include the character saying a specific line related to the product. Raw, TikTok-native, selfie-angle. Then your real product demo clip (configured in app.json). Uses Veo 3.1.',
    slides: 0,
    imageGen: false,
    textOverlay: false,
    videoGen: true,
    reactionDurationSeconds: 8,
    promptGuidance: 'The videoPrompt describes a UGC selfie-style scene like ugc-reaction, BUT the character MUST be speaking. Include in the prompt: the character says "[LINE]" where LINE is a short frustrated/relatable statement about the problem the product solves. The generated video (Veo 3.1) will show a person talking to camera. 1-2 sentences max. Casual, first-person, TikTok rant energy. Examples: person sitting at desk, holding phone, looking frustrated, the character says "bro I just spent 2 hours copy-pasting the same post to 9 different apps". The tone is raw, relatable, slightly dramatic. Keep the spoken line under 15 words. The demo clip handles the solution — the talking clip sets up the problem.',
  },
};

/**
 * Resolve the default format for a platform based on historical usage.
 * Returns the most-used format in posts.json, or null if no history.
 */
function resolveDefaultFormat(appName, platform) {
  const postsData = loadJSON(paths.postsPath(appName, platform), { posts: [] });
  const formatCounts = {};
  for (const post of postsData.posts) {
    if (post.format) {
      formatCounts[post.format] = (formatCounts[post.format] || 0) + 1;
    }
  }
  const sorted = Object.entries(formatCounts).sort((a, b) => b[1] - a[1]);
  return sorted.length > 0 ? sorted[0][0] : null;
}

// ── Experiment data helpers ──────────────────────────────────────

// Use paths.js as the single source of truth
const experimentsPath = paths.experimentsPath;

function loadExperiments(appName, platform) {
  const filePath = experimentsPath(appName, platform);
  return loadJSON(filePath, {
    active: [],
    completed: [],
    candidates: [],
    killed: [],
  });
}

function saveExperiments(appName, platform, data) {
  const filePath = experimentsPath(appName, platform);
  saveJSON(filePath, data);
}

/**
 * Aggregate experiment performance from posts.json.
 * Returns metrics per format for the LLM to evaluate.
 * Only includes posted content (has postUrl).
 */
function aggregateExperimentMetrics(appName, platform, primaryMetric, engagementFormula, days = 14) {
  const postsPath = paths.postsPath(appName, platform);
  const postsData = loadJSON(postsPath, { posts: [] });
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const byFormat = {};

  for (const post of postsData.posts) {
    if (!post.date || new Date(post.date) < cutoff) continue;
    if (!post.postUrl) continue; // skip unposted drafts

    const format = post.format || 'unknown';
    if (!byFormat[format]) {
      byFormat[format] = { count: 0, totalMetric: 0, totalEngagement: 0, posts: [] };
    }

    const metricValue = engagementFormula
      ? engagementFormula(post)
      : (post[primaryMetric] || 0);
    
    // Use engagementFormula as single source of truth for engagement rate
    const engRate = engagementFormula ? engagementFormula(post) : (post.engagementRate || 0);

    byFormat[format].count++;
    byFormat[format].totalMetric += metricValue;
    byFormat[format].totalEngagement += engRate;
    byFormat[format].posts.push({
      text: post.text,
      date: post.date,
      [primaryMetric]: metricValue,
      engagementRate: engRate,
    });
  }

  // Calculate averages
  for (const [format, data] of Object.entries(byFormat)) {
    data.avgMetric = data.count > 0 ? Math.round(data.totalMetric / data.count * 100) / 100 : 0;
    data.avgEngagement = data.count > 0 ? Math.round(data.totalEngagement / data.count * 100) / 100 : 0;
  }

  return byFormat;
}

/**
 * Build experiment context block for POSTS_NEEDED output.
 * This is what the LLM sees during self-improve.
 */
function buildExperimentContext(appName, platform, primaryMetric, engagementFormula, days = 14) {
  const experiments = loadExperiments(appName, platform);
  const metrics = aggregateExperimentMetrics(appName, platform, primaryMetric, engagementFormula, days);

  // Enrich experiments with format descriptions and metrics
  const enriched = (list) => list.map(exp => ({
    ...exp,
    formatDescription: FORMATS[exp.format]?.description || 'Unknown format',
    slideStructure: FORMATS[exp.format]?.slideStructure || null,
    metrics: metrics[exp.format] || { count: 0, totalMetric: 0, avgMetric: 0, posts: [] },
  }));

  // Build format usage distribution from posts.json (shows LLM its own bias)
  const postsPath = paths.postsPath(appName, platform);
  const postsData = loadJSON(postsPath, { posts: [] });
  const allPosts = postsData.posts || postsData;
  const recentPosts = Array.isArray(allPosts) ? allPosts.slice(-50) : [];
  const formatUsage = {};
  for (const p of recentPosts) {
    const fmt = p.format || 'unknown';
    formatUsage[fmt] = (formatUsage[fmt] || 0) + 1;
  }

  return {
    formats: Object.fromEntries(Object.entries(FORMATS).filter(([name]) => {
      const allowed = FORMAT_PLATFORMS[name];
      return !allowed || allowed.length > 0;
    })),
    active: enriched(experiments.active),
    completed: experiments.completed.slice(-10), // last 10 for learning from past decisions
    candidates: enriched(experiments.candidates),
    controlMetrics: metrics, // all format metrics for comparison
    formatUsage, // how many of last 50 posts used each format — shows bias
    instructions: [
      'FORMAT STRATEGY — YOU OWN ALL DECISIONS:',
      '',
      'You have full control over which formats to use, how to prioritize them,',
      'and when to stop using a format. There are no mechanical guardrails.',
      '',
      'DATA PROVIDED:',
      '- formatUsage: your format distribution over the last 50 posts. Check this for bias.',
      '- controlMetrics: per-format engagement data from the last 14 days.',
      '- active/completed: experiment history showing what you\'ve tried and outcomes.',
      '- formats: all available format specs.',
      '',
      'STRATEGIC GUIDELINES (not rules — use your judgment):',
      '- Diversify. If you\'ve used one format for >60% of recent posts, that\'s overindexing.',
      '- Give new formats a fair shot (8-10 posts) before judging them.',
      '- Kill formats that consistently underperform after enough data.',
      '- Graduate formats that prove themselves — make them part of the regular rotation.',
      '- Consider the content-format fit: some hooks work better as stories, others as videos.',
      '- You can invent new formats. Describe them in your strategy notes.',
      '',
      'COMMANDS (in strategy notes):',
      'ACTIVATE_EXPERIMENT: <id> | KILL_EXPERIMENT: <id> | GRADUATE_EXPERIMENT: <id>',
      'ADD_CANDIDATE: {"id": "...", "format": "...", "description": "...", "minSample": 10}',
      '',
      'Include "format": "<format_name>" in each post blueprint.',
      'Explain your format decisions in STRATEGY_NOTES — this is your memory between runs.',
    ].join('\n'),
  };
}

/**
 * Parse experiment commands from LLM strategy notes.
 * Returns actions to apply.
 */
function parseExperimentCommands(strategyNotes) {
  if (!strategyNotes) return [];

  const commands = [];
  const lines = strategyNotes.split('\n');

  for (const line of lines) {
    const activateMatch = line.match(/ACTIVATE_EXPERIMENT:\s*(\S+)/i);
    if (activateMatch) {
      commands.push({ action: 'activate', id: activateMatch[1] });
    }

    const killMatch = line.match(/KILL_EXPERIMENT:\s*(\S+)/i);
    if (killMatch) {
      commands.push({ action: 'kill', id: killMatch[1] });
    }

    const graduateMatch = line.match(/GRADUATE_EXPERIMENT:\s*(\S+)/i);
    if (graduateMatch) {
      commands.push({ action: 'graduate', id: graduateMatch[1] });
    }

    const addMatch = line.match(/ADD_CANDIDATE:\s*(\{.*\})/i);
    if (addMatch) {
      try {
        const candidate = JSON.parse(addMatch[1]);
        commands.push({ action: 'add_candidate', data: candidate });
      } catch { /* malformed JSON, skip */ }
    }
  }

  return commands;
}

/**
 * Apply experiment commands to the experiments.json file.
 */
function applyExperimentCommands(appName, platform, commands) {
  if (!commands || commands.length === 0) return;

  const experiments = loadExperiments(appName, platform);
  const changes = [];

  for (const cmd of commands) {
    switch (cmd.action) {
      case 'activate': {
        const idx = experiments.candidates.findIndex(c => c.id === cmd.id);
        if (idx >= 0) {
          const exp = experiments.candidates.splice(idx, 1)[0];
          exp.activatedAt = new Date().toISOString();
          experiments.active.push(exp);
          changes.push(`Activated experiment: ${cmd.id}`);
        }
        break;
      }
      case 'kill': {
        const idx = experiments.active.findIndex(c => c.id === cmd.id);
        if (idx >= 0) {
          const exp = experiments.active.splice(idx, 1)[0];
          exp.killedAt = new Date().toISOString();
          exp.outcome = 'killed';
          experiments.completed.push(exp);
          changes.push(`Killed experiment: ${cmd.id}`);
        }
        break;
      }
      case 'graduate': {
        const idx = experiments.active.findIndex(c => c.id === cmd.id);
        if (idx >= 0) {
          const exp = experiments.active.splice(idx, 1)[0];
          exp.graduatedAt = new Date().toISOString();
          exp.outcome = 'graduated';
          experiments.completed.push(exp);
          changes.push(`Graduated experiment: ${cmd.id}`);
        }
        break;
      }
      case 'add_candidate': {
        if (cmd.data && cmd.data.id && cmd.data.format) {
          experiments.candidates.push({
            ...cmd.data,
            addedAt: new Date().toISOString(),
          });
          changes.push(`Added candidate: ${cmd.data.id}`);
        }
        break;
      }
    }
  }

  if (changes.length > 0) {
    saveExperiments(appName, platform, experiments);
    console.log(`🧪 Experiment changes: ${changes.join(', ')}`);
  }

  return changes;
}

/**
 * Get the generator type for a format.
 * Returns: 'ai-visual' | 'ai-text' | 'ai-video' | 'drive-photos' | 'drive-clips' | 'manual'
 */
function getGenerator(formatName) {
  const fmt = FORMATS[formatName];
  if (!fmt) return null;
  // Explicit generator field takes priority
  if (fmt.generator) return fmt.generator;
  // Fallback for formats without generator (shouldn't happen after migration)
  if (fmt.type === 'visual') return 'ai-visual';
  if (fmt.type === 'text') return 'ai-text';
  if (fmt.type === 'video') return 'ai-video';
  return null;
}

/**
 * Check if a format requires AI generation.
 */
function isAIGenerated(formatName) {
  const gen = getGenerator(formatName);
  return gen && gen.startsWith('ai-');
}

module.exports = {
  FORMATS,
  FORMAT_PLATFORMS,
  resolveDefaultFormat,
  buildExperimentContext,
  parseExperimentCommands,
  applyExperimentCommands,
  isAIGenerated,
};
