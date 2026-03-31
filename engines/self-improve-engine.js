#!/usr/bin/env node
/**
 * Shared Self-Improvement Engine (v2 — simplified)
 *
 * Does the data work: pulls analytics, updates hooks, manages queue.
 * Outputs structured signals for the cron agent to make strategic decisions.
 *
 * Can be called directly: node self-improve-engine.js --app dropspace --platform tiktok --days 14
 * Or programmatically via runSelfImprove(config).
 */

const fs = require('fs');
const path = require('path');
const { loadJSON, saveJSON, etDate, etHour, parseArgs, extractDeletionInfo } = require('../core/helpers');
const paths = require('../core/paths');
const { getPlatformDef } = require('../core/platforms');
const { dropspaceRequest, fetchBatchAnalytics, fetchPostHogReferrers, fetchGA4Traffic, fetchRecentLaunches, fetchAttributionData } = require('../core/api');
const { buildExperimentContext } = require('../core/formats');

const MAX_QUEUE = 14;

// Slide image URLs now come from GET /launches list response (media_assets field)
// No per-launch detail fetch needed.

async function _runSelfImprove(config) {
  const { getArg, hasFlag } = parseArgs();

  const appName = getArg('app');
  const days = parseInt(getArg('days') || '14');
  const dryRun = hasFlag('dry-run');

  if (!appName) {
    console.error('Usage: node self-improve-engine.js --app <name> --platform <platform> [--days 14] [--dry-run]');
    process.exit(1);
  }

  const { resolveApiKey } = require('../core/helpers');
  const DROPSPACE_KEY = resolveApiKey(appName);
  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
  let SUPABASE_PROJECT_ID = process.env.SUPABASE_PROJECT_ID;

  if (!DROPSPACE_KEY) {
    console.error(`ERROR: Dropspace API key not set (check apiKeyEnv in app.json or set DROPSPACE_API_KEY)`);
    process.exit(1);
  }

  const platform = config.platform;
  const primaryMetric = config.primaryMetric;
  const getMetricValue = config.engagementFormula || (post => post[primaryMetric] || 0);

  // File paths — all via paths.js
  const appDir = paths.platformDir(appName, platform);
  const postsFile = paths.postsPath(appName, platform);
  const strategyFile = paths.strategyPath(appName, platform);
  const reportsDirectory = paths.reportsDir(appName);

  // App config
  const appConfig = paths.loadAppConfig(appName) || {};
  

  if (!SUPABASE_PROJECT_ID && appConfig.integrations?.supabase?.projectId) {
    SUPABASE_PROJECT_ID = appConfig.integrations?.supabase.projectId;
  }

  // Check contentSource — self-improve only runs for ai-generated content
  const platConfig = appConfig.platforms?.[platform] || {};
  const contentSource = platConfig.contentSource || 'ai-generated';
  if (contentSource !== 'ai-generated') {
    console.log(`⏭ ${appName}/${platform}: contentSource is "${contentSource}" (not ai-generated), skipping self-improve`);
    process.stdout.write(`SKIPPED: contentSource=${contentSource}\n`);
    return;
  }

  console.log(`\n🔄 Self-improvement run: ${appName}/${platform} (last ${days} days)${dryRun ? ' [DRY RUN]' : ''}\n`);

  const changelog = [];

  // ── 1. Pull launches + analytics ──────────────────────────────
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const postsData = loadJSON(postsFile, { posts: [] });
  const strategy = loadJSON(strategyFile, { postQueue: [], postingTimes: [] });
  const knownLaunchIds = new Set(postsData.posts.map(h => h.launchId).filter(Boolean));
  const postQueueTexts = new Set(strategy.postQueue.map(q => (q.text || q).toLowerCase()));
  const appUrl = (appConfig.url || '').replace(/https?:\/\//, '').replace(/\/$/, '').toLowerCase();

  const recentLaunches = await fetchRecentLaunches(DROPSPACE_KEY, platform, cutoff, knownLaunchIds, appUrl, postQueueTexts);
  console.log(`📊 Found ${recentLaunches.length} ${platform} launches for ${appName} in last ${days} days`);

  // Read analytics from tracking.json (written by refresh-tracking.js at midnight)
  // Falls back to live API fetch if tracking.json is missing or stale (>26h old)
  const trackingJsonPath = path.join(paths.appRoot(appName), 'tracking.json');
  let batchAnalytics = new Map();
  let usedCachedTracking = false;
  try {
    const trackingData = loadJSON(trackingJsonPath, null);
    const age = trackingData?.updatedAt ? Date.now() - new Date(trackingData.updatedAt).getTime() : Infinity;
    if (trackingData?.analyticsById && age < 24 * 60 * 60 * 1000) {
      // Use cached analytics — convert object to Map
      for (const [id, data] of Object.entries(trackingData.analyticsById)) {
        batchAnalytics.set(id, data);
      }
      usedCachedTracking = true;
      console.log(`📊 Using cached tracking.json (${Math.round(age / 3600000)}h old): ${batchAnalytics.size} launches`);
    }
  } catch {}

  if (!usedCachedTracking) {
    // Fallback: fetch live from Dropspace API
    const launchIds = recentLaunches.map(l => l.id);
    batchAnalytics = await fetchBatchAnalytics(DROPSPACE_KEY, launchIds);
    console.log(`📊 Live batch analytics: ${batchAnalytics.size}/${launchIds.length} launches returned data`);
  }

  const postData = [];
  const deletedPosts = [];
  for (const launch of recentLaunches) {
    const analyticsData = batchAnalytics.get(launch.id);
    if (!analyticsData) {
      console.warn(`  ⚠️  No analytics data for ${launch.id}`);
      continue;
    }
    const platformData = (analyticsData.platforms || []).find(p => p.platform === platform);
    const metrics = config.extractMetrics(platformData);
    const deletionInfo = extractDeletionInfo(platformData);
    const entry = {
      launchId: launch.id,
      name: launch.name,
      createdAt: launch.created_at,
      postUrl: platformData?.post_url || null,
      mediaAssetUrls: (launch.media_assets || []).map(a => a.url).filter(Boolean),
      ...metrics,
    };
    if (deletionInfo) {
      entry.isDeleted = true;
      entry.deletedDetectedAt = deletionInfo.deletedDetectedAt;
      entry.deletionReason = deletionInfo.deletionReason;
      deletedPosts.push(entry);
    }
    postData.push(entry);
  }
  console.log(`📈 Processed ${postData.length} launches${deletedPosts.length > 0 ? ` (${deletedPosts.length} deleted)` : ''}\n`);
  if (deletedPosts.length > 0) {
    for (const dp of deletedPosts) {
      console.log(`  🗑️  DELETED: "${dp.name?.substring(0, 60)}" — reason: ${dp.deletionReason} (detected: ${dp.deletedDetectedAt || 'unknown'})`);
    }
  }

  // ── 2-3. Shared data (PostHog + GA4 + Attribution) with cross-process cache ──
  // PostHog referrers, GA4 traffic, and Supabase/Stripe attribution are per-app, not per-platform.
  // When 6 self-improve crons run simultaneously, cache the result so only one hits the APIs.
  const sharedCachePath = paths.selfImproveCachePath(appName, days);
  const CACHE_MAX_AGE_MS = 30 * 60 * 1000; // 30 min

  let phSources = [];
  let phTotal = 0;
  let phFromPlatform = 0;
  let ga4Data = null;
  let conversions = [];
  let totalRevenue = 0;

  let sharedCache = null;
  try {
    if (fs.existsSync(sharedCachePath)) {
      const raw = JSON.parse(fs.readFileSync(sharedCachePath, 'utf-8'));
      if (Date.now() - new Date(raw.cachedAt).getTime() < CACHE_MAX_AGE_MS) {
        sharedCache = raw;
        console.log(`📦 Using cached shared data (PostHog + GA4 + attribution) from ${raw.cachedAt}`);
      }
    }
  } catch { /* ignore stale/corrupt cache */ }

  if (sharedCache) {
    phSources = sharedCache.phSources || [];
    phTotal = sharedCache.phTotal || 0;
    ga4Data = sharedCache.ga4Data || null;
    conversions = sharedCache.conversions || [];
    totalRevenue = sharedCache.totalRevenue || 0;
    phFromPlatform = phSources.find(s => s.source === platform)?.count || 0;
    console.log(`🌐 PostHog (cached): ${phTotal} pageviews, ${phFromPlatform} from ${platform}`);
    if (ga4Data) console.log(`📈 GA4 (cached): ${ga4Data.totalUsers} users, ${ga4Data.totalPageviews} pageviews`);
    console.log(`💰 Conversions (cached): ${conversions.length} users, $${totalRevenue.toFixed(2)} revenue`);
  } else {
    // Fetch fresh data and cache it
    try {
      const phKey = process.env.POSTHOG_PERSONAL_API_KEY;
      const phProject = appConfig.integrations?.posthog?.projectId;
      if (phKey && phProject) {
        const phData = await fetchPostHogReferrers(phKey, phProject, days);
        const rawPH = phData.referrers;
        phSources = Object.entries(rawPH).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);
        phTotal = phSources.reduce((s, e) => s + e.count, 0);
        phFromPlatform = phSources.find(s => s.source === platform)?.count || 0;
        console.log(`🌐 PostHog: ${phTotal} pageviews, ${phFromPlatform} from ${platform}`);
        const topSrc = phSources.slice(0, 5).map(s => `${s.source}=${s.count}`).join(', ');
        console.log(`   Top sources: ${topSrc}`);
      }
    } catch (e) {
      console.warn(`⚠️  PostHog failed: ${e.message}`);
    }

    // GA4 traffic (reliable server-side collection, not affected by ad blockers)
    try {
      const ga4PropertyId = appConfig.integrations?.ga4?.propertyId;
      if (!ga4PropertyId) throw new Error('No GA4 propertyId in app.json integrations');
      ga4Data = await fetchGA4Traffic(ga4PropertyId, days);
      console.log(`📈 GA4: ${ga4Data.totalUsers} users, ${ga4Data.totalSessions} sessions, ${ga4Data.totalPageviews} pageviews`);
      if (ga4Data.bySource?.length) {
        const topGA4 = ga4Data.bySource.slice(0, 5).map(s => `${s.source}/${s.medium}=${s.sessions}`).join(', ');
        console.log(`   GA4 sources: ${topGA4}`);
      }
    } catch (e) {
      console.warn(`⚠️  GA4 failed: ${e.message}`);
    }

    try {
      const attrResult = await fetchAttributionData(
        cutoff, appConfig, SUPABASE_TOKEN, SUPABASE_PROJECT_ID, STRIPE_KEY
      );
      conversions = attrResult.conversions || [];
      totalRevenue = attrResult.totalRevenue || 0;
      const statusCounts = {};
      const sources = {};
      for (const c of conversions) {
        statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
        sources[c.source || 'unknown'] = (sources[c.source || 'unknown'] || 0) + 1;
      }
      const phEnriched = conversions.filter(c => c.firstTouchSource).length;
      console.log(`💰 Conversions: ${conversions.length} users (${statusCounts.signup_only || 0} signup, ${statusCounts.trialing || 0} trialing, ${statusCounts.active || 0} paid, ${statusCounts.cancelled || 0} cancelled)`);
      console.log(`💵 Revenue: $${totalRevenue.toFixed(2)}`);
      const srcStr = Object.entries(sources).map(([k, v]) => `${k}=${v}`).join(', ');
      if (srcStr) console.log(`📍 Sources: ${srcStr}`);
      if (phEnriched > 0) console.log(`🔗 ${phEnriched} sources enriched via PostHog first-touch`);
    } catch (e) {
      console.warn(`⚠️  Attribution failed: ${e.message}`);
    }

    // Cache for sibling platform runs
    try {
      fs.writeFileSync(sharedCachePath, JSON.stringify({
        cachedAt: new Date().toISOString(),
        phSources, phTotal, ga4Data, conversions, totalRevenue,
      }));
    } catch { /* non-critical */ }
  }

  // ── 3.5. Platform-level conversion summary ─────────────────────
  // Attribution is platform-level only (based on referrer/UTM source).
  // Post-level attribution is unreliable — with 10 posts/day across 6 platforms,
  // any time-window model just assigns credit arbitrarily.
  // Instead: tell the LLM how many conversions THIS PLATFORM drove, period.
  const platformConversions = conversions.filter(c => c.source === platform);
  const platformConversionCount = platformConversions.length;
  const platformConversionRevenue = platformConversions.reduce((s, c) => s + (c.revenue || 0), 0);

  // ── 4. Update posts.json ──────────────────────────────────────
  let newPosts = 0, updatedPosts = 0;

  let newlyDeletedCount = 0;
  for (const post of postData) {
    const postText = post.name;
    if (!postText) continue;
    const existing = postsData.posts.find(p => p.launchId === post.launchId || p.text?.toLowerCase() === postText.toLowerCase());

    if (existing) {
      // Track newly detected deletions
      if (post.isDeleted && !existing.isDeleted) {
        newlyDeletedCount++;
        console.log(`  🚨 Newly deleted: "${postText.substring(0, 60)}" — ${post.deletionReason}`);
      }
      // Update metrics + deletion fields
      for (const [k, v] of Object.entries(post)) {
        if (k !== 'launchId' && k !== 'name' && k !== 'createdAt') {
          existing[k] = v;
        }
      }
      existing.lastChecked = new Date().toISOString();
      if (!existing.launchId) existing.launchId = post.launchId;
      updatedPosts++;
    } else {
      // New post
      const date = new Date(post.createdAt);
      postsData.posts.push({
        launchId: post.launchId,
        text: postText,
        date: etDate(date),
        hour: etHour(date),
        ...post,
        lastChecked: new Date().toISOString(),
      });
      newPosts++;
      if (post.isDeleted) newlyDeletedCount++;
    }
  }
  if (newlyDeletedCount > 0) {
    changelog.push(`🗑️ ${newlyDeletedCount} post(s) detected as deleted`);
  }

  // Mark posts that have aged out of the analytics window
  const analyticsExpiry = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  for (const p of postsData.posts) {
    if (!p.metricsFinalAt && p.date && new Date(p.date) < analyticsExpiry) {
      p.metricsFinalAt = new Date().toISOString().split('T')[0];
    }
  }

  changelog.push(`Posts: ${newPosts} new, ${updatedPosts} updated`);

  // ── 5. Queue management ───────────────────────────────────────
  // Stale pruning (7 days) — queue is LIFO (newest first), so stale entries are at the bottom
  const staleDate = etDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const beforePrune = strategy.postQueue.length;
  strategy.postQueue = strategy.postQueue.filter(q => !q.addedAt || q.addedAt >= staleDate);
  const pruned = beforePrune - strategy.postQueue.length;
  if (pruned > 0) changelog.push(`🧹 Pruned ${pruned} stale hooks (now posts)`);

  // X research signals
  // Read X research signals from file (written by x-research cron)
  const signalsPath = paths.xResearchSignalsPath(appName);
  let xResearchResults = { signals: null, competitorHooks: {} };
  try {
    if (fs.existsSync(signalsPath)) {
      const raw = JSON.parse(fs.readFileSync(signalsPath, 'utf-8'));
      // Use signals if less than 6 hours old (resilient to delayed cron runs)
      const savedAt = raw.savedAt ? new Date(raw.savedAt).getTime() : 0;
      const ageHours = (Date.now() - savedAt) / (1000 * 60 * 60);
      if (ageHours < 6) {
        xResearchResults = raw;
        console.log(`🐦 X Research signals loaded (${raw.signals?.trendingAngles?.length || 0} angles, ${Object.keys(raw.competitorHooks || {}).length} competitors, ${ageHours.toFixed(1)}h old)`);
      } else {
        console.log(`🐦 X Research signals stale (${ageHours.toFixed(1)}h old) — skipping`);
      }
    } else {
      console.log('🐦 No X research signals file — skipping');
    }
  } catch (e) {
    console.warn(`⚠️  Could not read X research signals: ${e.message}`);
  }

  // Competitor data flows through researchSignals in POSTS_NEEDED (from x-research-signals.json)

  // Cross-pollination removed — the LLM sees all platforms' data in POSTS_NEEDED
  // and can decide to adapt winning angles across platforms on its own.

  // No re-sorting — the LLM writes hooks to the queue in strategic order.
  // schedule-day picks from the top, so position = priority.
  // The agent decides what to post next based on full context (performance,
  // research signals, variety, platform dynamics), not a metric score.

  // Hard cap
  if (strategy.postQueue.length > MAX_QUEUE) {
    const trimmed = strategy.postQueue.length - MAX_QUEUE;
    strategy.postQueue = strategy.postQueue.slice(0, MAX_QUEUE);
    changelog.push(`✂️ Trimmed ${trimmed} hooks (cap ${MAX_QUEUE})`);
  }

  // ── 6. POSTS_NEEDED signal for agent ───────────────────────────
  // Request enough slots to reach minQueue (from app.json, default 7), but never exceed MAX_QUEUE
  const minQueue = appConfig.minQueue || 7;
  const currentQueueLen = strategy.postQueue.length;
  const slotsToMin = Math.max(0, minQueue - currentQueueLen);
  const slotsToMax = MAX_QUEUE - currentQueueLen;
  const slotsAvailable = Math.max(slotsToMin, slotsToMax);
  // Determine platform type (needed for recentPosts mapping and POSTS_NEEDED)
  const platDef = getPlatformDef(platform);
  const supportsBoth = Array.isArray(platDef.supportedTypes) && platDef.supportedTypes.includes('visual') && platDef.supportedTypes.includes('text');
  const isVisual = platDef.type === 'visual' || supportsBoth;
  const isTextOnly = platDef.type === 'text' && !supportsBoth;

  // Always emit POSTS_NEEDED — even with 0 slots, the LLM needs to analyze performance
  // and write strategy notes. Notes only save via add-posts.js, so skipping this block
  // when the queue is full means notes go stale.
  {
    // Give LLM ALL posts from the analytics window — it decides what matters
    // Filter out unposted content (no postUrl = never published, metrics are meaningless)
    // Filter out deleted posts from performance analysis (shown separately as deletedPosts signal)
    const recentPosts = postsData.posts
      .filter(p => {
        if (!p.date) return false;
        if (!p.postUrl) return false; // Skip unposted drafts — 0 metrics would poison strategy
        if (p.isDeleted) return false; // Exclude deleted posts — metrics are unreliable
        const postDate = new Date(p.date);
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        return postDate >= cutoff;
      })
      .map(p => {
        const out = { text: p.text, date: p.date, format: p.format || null, [primaryMetric]: getMetricValue(p) };
        // Include ALL engagement metrics so LLM can see the full picture
        const metricFields = config.postMetricFields ? Object.keys(config.postMetricFields()) : [];
        for (const field of metricFields) {
          if (p[field] !== undefined) out[field] = p[field];
        }
        // Always compute engagement rate from engagementFormula (single source of truth)
        if (config.engagementFormula) {
          out.engagementRate = config.engagementFormula(p);
        }
        if (p.slideTexts) out.slideTexts = p.slideTexts;
        if (p.slidePrompts) out.slidePrompts = p.slidePrompts;
        if (p.caption) out.caption = p.caption;
        if (p.postBody) out.postBody = p.postBody;
        if (p.postUrl) out.postUrl = p.postUrl;

        return out;
      });

    // ── Format strategy (LLM-owned, no mechanical guardrails) ──
    const platformType = supportsBoth ? 'visual+text' : (isVisual ? 'visual' : 'text');

    console.log('\n--- POSTS_NEEDED ---');
    console.log(JSON.stringify({
      platform,
      app: appName,
      slotsAvailable,
      strategyPath: strategyFile,
      postType: platformType,
      ...(supportsBoth && { postTypeNote: 'This platform supports both visual (story-slideshow with images) and text (text-post). Choose the format that best fits each post. Set format field accordingly.' }),
      product: {
        name: appConfig.name || appName,
        description: appConfig.description || '',
        audience: appConfig.audience || '',
        problem: appConfig.problem || '',
        differentiator: appConfig.differentiator || '',
        voice: appConfig.voice || '',
      },
      platformConversions: {
        count: platformConversionCount,
        revenue: platformConversionRevenue,
        note: 'Platform-level only (referrer/UTM). Cannot attribute to specific posts.',
      },
      ga4Traffic: ga4Data ? {
        totalUsers: ga4Data.totalUsers,
        totalSessions: ga4Data.totalSessions,
        totalPageviews: ga4Data.totalPageviews,
        topSources: ga4Data.bySource?.slice(0, 8) || [],
        topPages: ga4Data.byPage?.slice(0, 5) || [],
        note: 'GA4 is the reliable traffic baseline (server-side collection). Use for acquisition analysis.',
      } : null,
      researchSignals: xResearchResults.signals ? {
        trendingAngles: xResearchResults.signals.trendingAngles?.slice(0, 8) || [],
        competitorPositioning: xResearchResults.signals.competitorPositioning || [],
        topExamples: xResearchResults.signals.topExamples || [],
      } : null,
      recentPosts,
      deletedPosts: (() => {
        const deleted = postsData.posts.filter(p => p.isDeleted && p.date);
        if (deleted.length === 0) return null;
        return deleted.map(p => ({
          text: p.text, date: p.date, deletionReason: p.deletionReason,
          deletedDetectedAt: p.deletedDetectedAt,
        }));
      })(),
      previousNotes: strategy.notes || null,
      crossPlatformNotes: (() => {
        try {
          const cpPath = paths.insightsPath(appName);
          return JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
        } catch { return null; }
      })(),
      formatGuide: (() => {
        try {
          const formatPath = paths.appRoot(appName) + '/config/FORMAT.md';
          return fs.readFileSync(formatPath, 'utf-8');
        } catch { return ''; }
      })(),
      antiPatterns: (() => {
        try {
          const ap = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ANTI-PATTERNS.md'), 'utf-8');
          // Extract just banned words/phrases sections (compact)
          const banned = ap.match(/### Banned words\/phrases:[\s\S]*?(?=###|---)/g) || [];
          const aiWords = ap.match(/### High-signal AI words:[\s\S]*?(?=###|---)/g) || [];
          return 'ANTI-PATTERNS (banned in ALL generated text): ' + [...banned, ...aiWords].join(' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').slice(0, 1500);
        } catch { return ''; }
      })(),

      strategy: isVisual ? {
        instructions: 'Generate COMPLETE post blueprints, not just hooks. Each post should be a cohesive unit. VOICE + FORMAT: Read the formatGuide field — it contains the full FORMAT.md for this app. Follow it strictly for voice, style, platform rules, and anti-patterns. Also read the antiPatterns field for banned words/phrases.',
        format: 'Each post needs: text (hook/opening line), slideTexts, caption (with hashtags), and EITHER slidePrompts OR sceneAnchor+slideMoods depending on format. CHECK each format\'s slideStructure in the format context — it tells you the exact fields required. KEY: story-slideshow format uses sceneAnchor (ONE detailed scene description) + slideMoods (array of 5 emotional/lighting changes) — NOT slidePrompts. If a format has ctaSlide=true, the engine auto-appends a CTA slide — generate only content slides.',
        contentStrategy: 'YOU own the content strategy. recentPosts has ALL posts from the past 14 days with FULL metrics including engagementRate (likes+comments+shares/views as %). ENGAGEMENT RATE IS THE REAL SIGNAL — raw views only measure distribution, engagement rate measures content quality. A post with 250 views and 5% engagement is vastly better than one with 300 views and 0% engagement. platformConversions shows how many signups THIS PLATFORM drove (based on referrer/UTM — the only reliable attribution). ga4Traffic shows real website traffic from Google Analytics (server-side, reliable) — use topSources to see which channels actually drive visits and topPages to see what content converts. If GA4 shows traffic from a platform but zero conversions, the landing page or CTA might be the problem, not the content. previousNotes has your strategic reasoning from last run — read it, build on it, revise it. If deletedPosts is present, posts were removed by the platform — check deletionReason. moderation_removed or spam_filtered = content quality problem, adjust strategy to avoid similar content. creator_deleted = manual removal, ignore. Analyze everything and make your own call.',
        ordering: 'ORDER MATTERS. New posts are prepended to the queue and schedule-day picks from the top. Place your BEST strategic pick first.',
        noHardcodedMetrics: 'STRICT: Never include real metrics anywhere — no user counts, revenue, signup counts, view counts, day counts, or specific timeframes. All content must be evergreen.',
        slideRule: 'LLM generates ALL slides including CTA when ctaSlide=true. story-slideshow=6 slides (5 story + 1 CTA background). Slide 1 = hook (scroll-stopper). CTA slides should be same visual world as content but darker/muted for text readability.',
        formatField: 'Include "format": "<format_name>" in each post blueprint. ONLY use formats from the allowedFormats list below. Any other format will be rejected by the pipeline.',
        videoFormats: 'VIDEO FORMATS (ugc-reaction, ugc-talking): These need { text, videoPrompt, caption, format } — NOT slideTexts/slidePrompts. videoPrompt is the generation prompt sent to Veo 3.1. Both formats: describe a UGC selfie-style scene — person holding phone, front-facing camera, raw TikTok-native feel. ugc-reaction: 4s silent clip + demo. ugc-talking: 8s talking clip + demo. demo length configured in app.json. ugc-reaction: frustrated SILENT reaction (eye roll, head in hands, staring at screen). The person does NOT speak. ugc-talking: same setup BUT the prompt MUST include: the character says "[LINE]" where LINE is a short frustrated statement about the problem. Example: person at desk holding phone, the character says "bro I just spent 2 hours copy-pasting to 9 apps". Keep the spoken line under 15 words, casual first-person. All video prompts must be under 500 chars.',
        visualFeedback: 'recentPosts include each post\'s slideTexts and format. Compare what you generated to engagement metrics — note which prompt styles and text approaches drove higher engagement rates and adjust accordingly.',
        strategyNotes: 'After generating posts, output a --- STRATEGY_NOTES --- block. This is your memory between runs — be SPECIFIC and ANALYTICAL, not vague. Required sections: (1) PERFORMANCE ANALYSIS: Which hooks got the highest/lowest engagement rates? What do the winners have in common? What pattern do the losers share? Cite specific posts with their metrics. (2) CONVERSION ANALYSIS: How many signups did this platform drive (see platformConversions)? Cross-reference with ga4Traffic — does GA4 show this platform sending traffic? If GA4 shows visits but no conversions, the problem is landing page/CTA, not content. (3) HOOK STRATEGY: Based on the data, what hook formula are you doubling down on? What are you abandoning? (4) VISUAL QUALITY: If you reviewed slideImageUrls, what worked visually vs what looked bad? (5) FORMAT STRATEGY: Review formatUsage — are you overindexing on one format? Which formats are working and which aren\'t? Decide which to use more/less of, and why. Include experiment commands (ACTIVATE_EXPERIMENT, KILL_EXPERIMENT, GRADUATE_EXPERIMENT, ADD_CANDIDATE) if changing format roster. (6) NEXT RUN PLAN: What specifically will you try differently tomorrow and why? This gets saved and fed back to you tomorrow — write it like a memo to yourself.',
        correlationGuide: 'The "correlations" field contains structured performance data extracted from ALL historical posts. Each correlation has a pattern, sample size, metric averages, and a signal (strong/weak/positive/negative/neutral). Use these to inform your content strategy — they are DATA, not rules. Draw your own conclusions. "directiveRules" are absolute constraints from the user — always follow those. You can still add new directive-style rules to the "failures" array if the user gives feedback, but prefer letting the correlation data guide your creative decisions.',
      } : {
        instructions: 'Generate COMPLETE post blueprints, not just hooks. VOICE + FORMAT: Read the formatGuide field — it contains the full FORMAT.md for this app. Follow it strictly for voice, style, platform rules, and anti-patterns. Also read the antiPatterns field for banned words/phrases.',
        format: 'Each post needs: text (hook/opening line), postBody (the full post text — for Twitter write a single tweet up to 25,000 chars (Premium account), for LinkedIn keep under 700 chars, for Reddit write 2-4 paragraphs). Twitter posts should be single tweets, NOT threads.',
        contentStrategy: 'YOU own the content strategy. recentPosts has ALL posts from the past 14 days with FULL metrics including engagementRate. ENGAGEMENT RATE IS THE REAL SIGNAL — raw impressions/views only measure distribution, engagement rate measures content quality. platformConversions shows how many signups THIS PLATFORM drove (based on referrer/UTM — the only reliable attribution). ga4Traffic shows real website traffic from Google Analytics (server-side, reliable) — use topSources to see which channels drive visits and topPages for what converts. previousNotes has your strategic reasoning from last run — read it, build on it, revise it. If deletedPosts is present, posts were removed by the platform — check deletionReason. moderation_removed or spam_filtered = content quality problem, adjust strategy to avoid similar content. Analyze everything and make your own call.',
        ordering: 'ORDER MATTERS. New posts are prepended to the queue and schedule-day picks from the top. Place your BEST strategic pick first.',
        noHardcodedMetrics: 'STRICT: Never include real metrics anywhere — no user counts, revenue, signup counts, view counts, day counts, or specific timeframes. All content must be evergreen.',
        formatField: 'Include "format": "<format_name>" in each post blueprint. ONLY use formats from the allowedFormats list below. Any other format will be rejected by the pipeline.',
        strategyNotes: 'After generating posts, output a --- STRATEGY_NOTES --- block. This is your memory between runs — be SPECIFIC and ANALYTICAL, not vague. Required sections: (1) PERFORMANCE ANALYSIS: Which posts got the highest/lowest engagement rates? What do the winners have in common? What pattern do the losers share? Cite specific posts with their metrics. (2) CONVERSION ANALYSIS: How many signups did this platform drive (see platformConversions)? Cross-reference with ga4Traffic — does GA4 show this platform sending traffic? If visits but no conversions, problem is landing page/CTA, not content. (3) HOOK STRATEGY: Based on the data, what hook formula are you doubling down on? What are you abandoning? (4) FORMAT STRATEGY: Review formatUsage — are you overindexing on one format? Decide which formats to use more/less of, and why. Include experiment commands if changing format roster. (5) NEXT RUN PLAN: What specifically will you try differently tomorrow and why? This gets saved and fed back to you tomorrow — write it like a memo to yourself.',
        correlationGuide: 'The "correlations" field contains structured performance data extracted from ALL historical posts. Each correlation has a pattern, sample size, metric averages, and a signal (strong/weak/positive/negative/neutral). Use these to inform your content strategy — they are DATA, not rules. Draw your own conclusions. "directiveRules" are absolute constraints from the user — always follow those. You can still add new directive-style rules to the "failures" array if the user gives feedback, but prefer letting the correlation data guide your creative decisions.',
      },
      allowedFormats: (() => {
        const expPath = paths.experimentsPath(appName, platform);
        const expData = loadJSON(expPath, { active: [], killed: [], completed: [] });
        const killedFormats = new Set([
          ...((expData.killed || []).map(k => k.format)),
          ...((expData.completed || []).filter(c => c.outcome === 'killed' || c.outcome === 'auto-killed').map(c => c.format)),
        ]);
        const { FORMATS, FORMAT_PLATFORMS, isAIGenerated } = require('../core/formats');
        return Object.entries(FORMATS)
          .filter(([name]) => {
            if (killedFormats.has(name)) return false;
            // Self-improve only generates AI formats — exclude manual/manual
            if (!isAIGenerated(name)) return false;
            const allowed = FORMAT_PLATFORMS[name];
            if (!allowed || allowed.length === 0) return false;
            return allowed.includes(platform);
          })
          .map(([name]) => name);
      })(),
      existingQueue: strategy.postQueue.map(h => h.text || h),
      formatContext: buildExperimentContext(appName, platform, primaryMetric, getMetricValue, days),
      // Structured performance correlations — data, not rules. Draw your own conclusions.
      correlations: (() => {
        try {
          const { analyze: analyzeCorrelations } = require('../core/correlations');
          // PRIMARY_METRIC mapping
          const metricMap = { tiktok: 'views', instagram: 'views', facebook: 'engagement', twitter: 'impressions', linkedin: 'impressions', reddit: 'score' };
          return analyzeCorrelations(postsData.posts, metricMap[platform] || 'views');
        } catch { return { correlations: [], meta: { error: 'correlation engine unavailable' } }; }
      })(),
      // Directive rules from user — these are absolute constraints, not data-driven
      directiveRules: (() => {
        const rules = [];
        const directiveSources = ['user-directive', 'user-feedback', 'manual review'];
        // Load shared cross-platform failures (directive only)
        try {
          const sharedPath = paths.sharedFailuresPath(appName);
          const raw = JSON.parse(fs.readFileSync(sharedPath, 'utf-8'));
          const entries = Array.isArray(raw) ? raw : (raw.failures || []);
          for (const r of entries) {
            if (typeof r === 'string') continue; // Legacy bare strings — no source, skip
            // Keep ONLY rules from user or manual review
            if (r.source && directiveSources.some(s => r.source.toLowerCase().includes(s))) {
              rules.push(r.rule);
            }
            // All other rules (auto-generated, no source) are skipped — correlations.js handles data-driven insights
          }
        } catch { /* no shared failures */ }
        // Load platform-specific failures (directive only)
        try {
          const failPath = paths.failuresPath(appName, platform);
          const raw = JSON.parse(fs.readFileSync(failPath, 'utf-8'));
          const entries = Array.isArray(raw) ? raw : (raw.failures || []);
          for (const r of entries) {
            if (typeof r === 'string') continue; // Legacy bare strings — skip
            if (r.source && directiveSources.some(s => r.source.toLowerCase().includes(s))) {
              rules.push(r.rule);
            }
          }
        } catch { /* no platform failures */ }
        return [...new Set(rules.filter(Boolean))];
      })(),
    }, null, 2));
    console.log('--- END_POSTS_NEEDED ---');
  } // end POSTS_NEEDED block

  // ── 7. Save ───────────────────────────────────────────────────
  if (!dryRun) {
    saveJSON(postsFile, postsData);
    console.log(`✅ Wrote ${postsFile}`);
    saveJSON(strategyFile, strategy);
    console.log(`✅ Wrote ${strategyFile}`);
  }

  // ── 8. Report ─────────────────────────────────────────────────
  // Filter out unposted content and deleted posts from metrics
  const postedData = postData.filter(p => p.postUrl && !p.isDeleted);
  const deletedCount = postData.filter(p => p.isDeleted).length;
  const unpostedCount = postData.length - postedData.length - deletedCount;
  const totalMetric = postedData.reduce((s, p) => s + getMetricValue(p), 0);
  const avgMetric = postedData.length > 0 ? Math.round(totalMetric / postedData.length) : 0;
  const postsWithData = postsData.posts.filter(p => p.postUrl && getMetricValue(p) > 0).length;

  // ── Attribution filtering ──
  // Only count conversions attributable to automation (utm_campaign=openclaw)
  // or link-in-bio platforms (tiktok/instagram — no UTM tracking possible)
  const LINK_IN_BIO_PLATFORMS = ['tiktok', 'instagram'];
  const autoConversions = conversions.filter(c =>
    c.utmCampaign === 'openclaw' ||
    LINK_IN_BIO_PLATFORMS.includes(c.source)
  );
  const otherConversions = conversions.filter(c =>
    c.utmCampaign !== 'openclaw' &&
    !LINK_IN_BIO_PLATFORMS.includes(c.source)
  );
  const autoRevenue = autoConversions.reduce((s, c) => s + (c.revenue || 0), 0);

  const autoStatusCounts = {};
  for (const c of autoConversions) {
    autoStatusCounts[c.status] = (autoStatusCounts[c.status] || 0) + 1;
  }

  // Sort posts by metric for top/bottom display (only posted content)
  const sortedPosts = [...postedData].sort((a, b) => getMetricValue(b) - getMetricValue(a));

  // Compute aggregate engagement rate (single source: config.engagementFormula)
  const engagementValues = postedData
    .map(p => config.engagementFormula ? config.engagementFormula(p) : 0)
    .filter(r => r !== undefined);
  const avgEngagement = engagementValues.length > 0
    ? (engagementValues.reduce((s, r) => s + r, 0) / engagementValues.length).toFixed(2)
    : '0.00';
  const engagementIsScore = config.engagementIsScore || false;
  const engagementLabel = engagementIsScore ? 'engagement score' : 'engagement rate';
  const engagementUnit = engagementIsScore ? '' : '%';

  const reportLines = [
    `\n${'='.repeat(60)}`,
    `# Self-Improvement Report — ${appName}/${platform} — ${etDate(new Date())}`,
    '',
    `## Summary (last ${days} days)`,
    `- Posts analyzed: ${postedData.length}${unpostedCount > 0 ? ` (${unpostedCount} unposted drafts excluded)` : ''}${deletedCount > 0 ? ` (${deletedCount} deleted posts excluded)` : ''}`,
    `- Total ${primaryMetric}: ${totalMetric.toLocaleString()}`,
    `- Avg ${primaryMetric}/post: ${avgMetric.toLocaleString()}`,
    `- **Avg ${engagementLabel}: ${avgEngagement}${engagementUnit}**`,
    `- Posts tracked: ${postsData.posts.length} (${postsWithData} with data)`,
    `- Automation-attributed signups: ${autoConversions.length} (${autoStatusCounts.signup_only || 0} signup, ${autoStatusCounts.trialing || 0} trialing, ${autoStatusCounts.active || 0} paid, ${autoStatusCounts.cancelled || 0} cancelled)`,
    `- Automation-attributed revenue: $${autoRevenue.toFixed(2)}`,
    ...(otherConversions.length > 0 ? [`- Other signups (manual campaigns): ${otherConversions.length} (NOT from automation — do not take credit)`] : []),
    '',
    `## Changes`,
    ...changelog.map(c => `- ${c}`),
    '',
  ];

  // Top posts (by primary metric, with engagement rate)
  if (sortedPosts.length > 0) {
    reportLines.push('## Top Posts (by ' + primaryMetric + ')');
    for (const p of sortedPosts.slice(0, 5)) {
      const eng = config.engagementFormula ? config.engagementFormula(p) : (p.engagementRate || 0);
      reportLines.push(`- ${p.name}: ${getMetricValue(p).toLocaleString()} ${primaryMetric} (${eng.toFixed(1)}% engagement)`);
    }
    reportLines.push('');

    // Also show top posts by engagement rate (different ranking)
    if (config.engagementFormula) {
      const byEngagement = [...postedData]
        .map(p => ({ ...p, _eng: config.engagementFormula(p) }))
        .filter(p => getMetricValue(p) > 0) // only posts with some reach
        .sort((a, b) => b._eng - a._eng);
      if (byEngagement.length > 0) {
        reportLines.push('## Top Posts (by engagement rate)');
        for (const p of byEngagement.slice(0, 5)) {
          reportLines.push(`- ${p.name}: ${p._eng.toFixed(1)}% engagement (${getMetricValue(p).toLocaleString()} ${primaryMetric})`);
        }
        reportLines.push('');
      }
    }
  }

  // Platform-level conversions
  if (platformConversionCount > 0) {
    reportLines.push(`## 💰 Platform Conversions: ${platformConversionCount} signup(s), $${platformConversionRevenue.toFixed(2)} revenue`);
    reportLines.push(`(Based on referrer/UTM attribution — cannot tie to specific posts)`);
    reportLines.push('');
  }

  // Deleted posts
  if (deletedCount > 0) {
    const deleted = postData.filter(p => p.isDeleted);
    reportLines.push('## ⚠️ Deleted Posts');
    const byReason = {};
    for (const d of deleted) {
      const r = d.deletionReason || 'unknown';
      if (!byReason[r]) byReason[r] = [];
      byReason[r].push(d);
    }
    for (const [reason, posts] of Object.entries(byReason)) {
      reportLines.push(`### ${reason} (${posts.length})`);
      for (const p of posts) {
        reportLines.push(`- "${(p.name || '').substring(0, 60)}" (detected: ${p.deletedDetectedAt || 'unknown'})`);
      }
    }
    const moderationCount = deleted.filter(d => ['moderation_removed', 'spam_filtered'].includes(d.deletionReason)).length;
    if (moderationCount > 0) {
      reportLines.push(`\n⚠️ **${moderationCount} post(s) removed by platform moderation** — review content strategy to avoid similar removals.`);
    }
    reportLines.push('');
  }

  // Traffic
  if (ga4Data && ga4Data.totalPageviews > 0) {
    reportLines.push('## Website Traffic (GA4 — reliable baseline)');
    reportLines.push(`- Users: ${ga4Data.totalUsers} | Sessions: ${ga4Data.totalSessions} | Pageviews: ${ga4Data.totalPageviews}`);
    if (ga4Data.bySource?.length) {
      reportLines.push('- Top sources:');
      for (const s of ga4Data.bySource.slice(0, 5)) {
        reportLines.push(`  - ${s.source}/${s.medium}: ${s.sessions} sessions, ${s.users} users`);
      }
    }
    reportLines.push('');
  }
  if (phTotal > 0) {
    reportLines.push('## Website Traffic (PostHog — client-side)');
    reportLines.push(`- Total pageviews: ${phTotal}`);
    reportLines.push(`- From ${platform}: ${phFromPlatform} (${Math.round(phFromPlatform / phTotal * 100)}%)`);
    for (const s of phSources.slice(0, 5)) {
      reportLines.push(`- ${s.source}: ${s.count} views`);
    }
    reportLines.push('');
  }

  // Attribution breakdown (autoConversions/otherConversions computed above)
  if (conversions.length > 0) {
    if (autoConversions.length > 0) {
      reportLines.push('## Automation-Attributed Signups (utm_campaign=openclaw or link-in-bio platforms)');
      const autoSourceCounts = {};
      for (const c of autoConversions) autoSourceCounts[c.source || 'unknown'] = (autoSourceCounts[c.source || 'unknown'] || 0) + 1;
      for (const [src, count] of Object.entries(autoSourceCounts)) {
        const paidFromSrc = autoConversions.filter(c => c.source === src && c.status === 'active').length;
        const revFromSrc = autoConversions.filter(c => c.source === src).reduce((s, c) => s + (c.revenue || 0), 0);
        reportLines.push(`- **${src}**: ${count} signups, ${paidFromSrc} paid ($${revFromSrc.toFixed(2)})`);
      }
      reportLines.push('');
    }

    if (otherConversions.length > 0) {
      reportLines.push('## Other Signups (manual campaigns — NOT from automation, do not use for strategy decisions)');
      const otherSourceCounts = {};
      for (const c of otherConversions) otherSourceCounts[c.source || 'unknown'] = (otherSourceCounts[c.source || 'unknown'] || 0) + 1;
      for (const [src, count] of Object.entries(otherSourceCounts)) {
        const campaign = otherConversions.find(c => (c.source || 'unknown') === src)?.utmCampaign;
        const campaignLabel = campaign ? ` (campaign=${campaign})` : '';
        reportLines.push(`- **${src}**: ${count} signups${campaignLabel}`);
      }
      reportLines.push('');
    }
  }

  // Post queue
  reportLines.push('## Hook Queue');
  for (let i = 0; i < strategy.postQueue.length; i++) {
    const h = strategy.postQueue[i];
    const q = '';
    reportLines.push(`${i + 1}. "${(h.text || h).substring(0, 80)}"${q}`);
  }
  reportLines.push('');

  // Platform-specific extras
  if (config.reportExtras) {
    const extras = config.reportExtras({ postData, postsData, strategy, conversions: autoConversions, totalRevenue: autoRevenue, phSources, phTotal });
    if (extras && extras.length > 0) {
      reportLines.push(...extras, '');
    }
  }

  reportLines.push('='.repeat(60));

  const report = reportLines.join('\n');
  console.log(report);

  // Save report
  if (!dryRun) {
    if (!fs.existsSync(reportsDirectory)) fs.mkdirSync(reportsDirectory, { recursive: true });
    const reportPath = path.join(reportsDirectory, `${etDate(new Date())}-${appName}.md`);
    fs.writeFileSync(reportPath, report);
    console.log(`✅ Wrote ${reportPath}`);
  }

  if (dryRun) console.log('\n🏃 Dry run — no files written');
}

async function runSelfImprove(config) {
  try {
    await _runSelfImprove(config);
  } catch (e) {
    console.error(`\n❌ Fatal: ${e.message}\n${e.stack}`);
    process.exit(1);
  }
}

// CLI entry point: node self-improve-engine.js --app dropspace --platform tiktok --days 14
if (require.main === module) {
  const { getArg } = parseArgs();
  const platformName = getArg('platform');
  if (!platformName) {
    console.error('Usage: node self-improve-engine.js --app <name> --platform <platform> [--days 14] [--dry-run]');
    process.exit(1);
  }
  const platDef = getPlatformDef(platformName);
  runSelfImprove(platDef);
}

module.exports = { runSelfImprove };
