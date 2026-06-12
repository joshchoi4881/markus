#!/usr/bin/env node
/**
 * Add posts to a platform's strategy.json queue atomically.
 * Also saves strategy notes and cross-platform insights in the same write.
 *
 * Usage (stdin JSON object):
 *   echo '{"posts":[...], "notes":"...", "crossNotes":"..."}' | \
 *     node add-posts.js --app dropspace --platform facebook
 *
 * Stdin JSON fields:
 *   posts:      Array of post objects [{text, ...}, ...]
 *   notes:      Strategy notes for this platform (saved to strategy.notes)
 *   crossNotes: Insights for other platforms (saved to insights.json)
 *   failures:   Array of failure rule strings to append to platform failures.json
 *
 * Deduplicates against existing queue + posting history.
 * Respects MAX_QUEUE (14) cap.
 */

const fs = require('fs');
const path = require('path');
const { loadJSON, saveJSON, etDate, parseArgs, CHAR_LIMITS } = require('../core/helpers');
const paths = require('../core/paths');
// platforms.js imported only if needed at runtime
const { parseExperimentCommands, applyExperimentCommands, FORMAT_PLATFORMS, FORMATS } = require('../core/formats');

const MAX_QUEUE = 14;

function checkCharLimits(post, platform) {
  const limits = CHAR_LIMITS[platform];
  if (!limits) return null;

  // Text platform postBody check
  if (post.postBody && limits.postBody) {
    const isThread = platform === 'twitter' && (post.format === 'text-thread' || (!post.format && post.postBody.includes('\n\n')));
    if (isThread) {
      // Check each tweet in thread
      const body = typeof post.postBody === 'string' ? post.postBody : post.postBody.join('\n\n');
      const tweets = body.split('\n\n');
      if (limits.maxThreadTweets && tweets.length > limits.maxThreadTweets) {
        return `thread has ${tweets.length} tweets (max ${limits.maxThreadTweets})`;
      }
      for (let i = 0; i < tweets.length; i++) {
        if (tweets[i].length > limits.threadTweet) {
          return `tweet ${i + 1} is ${tweets[i].length}/${limits.threadTweet} chars`;
        }
      }
    } else if (platform === 'twitter' && post.format === 'text-single') {
      // Single tweet — enforce 280 char limit on full body, regardless of \n\n
      const body = typeof post.postBody === 'string' ? post.postBody : post.postBody.join('\n\n');
      if (body.length > limits.postBody) {
        return `single tweet is ${body.length}/${limits.postBody} chars (format=text-single)`;
      }
    } else if (post.postBody.length > limits.postBody) {
      return `postBody is ${post.postBody.length}/${limits.postBody} chars`;
    }
  }

  // Visual platform caption check
  if (post.caption && limits.caption && post.caption.length > limits.caption) {
    return `caption is ${post.caption.length}/${limits.caption} chars`;
  }

  return null;
}

function checkFormatFields(post, platform) {
  if (typeof post !== 'object' || !post.format) return null;
  const fmt = FORMATS[post.format];
  if (!fmt || fmt.type !== 'visual') return null;

  // Larry format: must have sceneAnchor + slideMoods, NOT slidePrompts
  if (fmt.usesSceneAnchor) {
    if (!post.sceneAnchor || !post.slideMoods) {
      if (post.slidePrompts) {
        return `format "${post.format}" requires sceneAnchor+slideMoods but got slidePrompts — visual consistency will suffer. Add sceneAnchor (scene description) and slideMoods (array of ${(fmt.slides || 6) - (fmt.ctaSlide ? 1 : 0)} mood strings)`;
      }
      return `format "${post.format}" requires sceneAnchor+slideMoods`;
    }
    const expectedMoods = (fmt.slides || 6) - (fmt.ctaSlide ? 1 : 0);
    if (post.slideMoods.length !== expectedMoods) {
      return `format "${post.format}" needs ${expectedMoods} slideMoods, got ${post.slideMoods.length}`;
    }
  } else if (fmt.imageGen && !fmt.usesSceneAnchor) {
    // Other visual formats: must have slidePrompts
    if (!post.slidePrompts || !Array.isArray(post.slidePrompts) || post.slidePrompts.length === 0) {
      return `format "${post.format}" requires slidePrompts array`;
    }
  }

  // All visual formats need slideTexts
  if (fmt.textOverlay && (!post.slideTexts || !Array.isArray(post.slideTexts) || post.slideTexts.length === 0)) {
      if (!post.slideLabels || post.slideLabels.length !== 4) {
    }
    return `format "${post.format}" requires slideTexts array`;
  }

  return null;
}

function main() {
  const { getArg } = parseArgs();

  const appName = getArg('app');
  const platform = getArg('platform');

  if (!appName || !platform) {
    console.error('Usage: echo \'{"posts":[...], "notes":"...", "crossNotes":"..."}\' | node add-posts.js --app <name> --platform <platform>');
    process.exit(1);
  }

  const strategyFile = paths.strategyPath(appName, platform);
  const postsFile = paths.postsPath(appName, platform);

  // Read stdin JSON: {posts: [...], notes?: "...", crossNotes?: "..."}
  let newPosts;
  let effectiveNotes = null;
  let effectiveCrossNotes = null;

  let effectiveFailures = null;

  const input = fs.readFileSync(0, 'utf-8').trim();
  if (!input) {
    console.error('No input on stdin. Pipe a JSON object: {"posts":[...], "notes":"...", "crossNotes":"...", "failures":[...]}');
    process.exit(1);
  }

  const parsed = JSON.parse(input);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (!Array.isArray(parsed.posts)) {
      console.error('Stdin JSON must have a "posts" array: {"posts":[...], "notes":"...", "crossNotes":"...", "failures":[...]}');
      process.exit(1);
    }
    newPosts = parsed.posts;
    if (parsed.notes) effectiveNotes = parsed.notes;
    if (parsed.crossNotes) effectiveCrossNotes = parsed.crossNotes;
    if (parsed.failures && Array.isArray(parsed.failures)) effectiveFailures = parsed.failures;
  } else {
    console.error('Stdin must be a JSON object: {"posts":[...], "notes":"...", "crossNotes":"...", "failures":[...]}');
    process.exit(1);
  }

  // Load current state (fresh read — atomic)
  const strategy = loadJSON(strategyFile, { postQueue: [] });
  const history = loadJSON(postsFile, { posts: [] });

  // Build dedup set from queue + posting history
  const existing = new Set([
    ...(strategy.postQueue || []).map(h => (h.text || h).toLowerCase()),
    ...history.posts.map(p => (p.text || '').toLowerCase()),
  ]);

  // Apply experiment commands from strategy notes BEFORE processing posts.
  // This ensures that if the LLM says KILL_EXPERIMENT in notes, the killed format
  // is already written to experiments.json before we check killedFormats below.
  if (effectiveNotes) {
    const earlyCommands = parseExperimentCommands(effectiveNotes);
    if (earlyCommands.length > 0) {
      applyExperimentCommands(appName, platform, earlyCommands);
    }
  }

  let added = 0;
  let skipped = 0;

  let rejected = 0;

  // Load killed formats to reject them (AFTER experiment commands applied above)
  const expPath = paths.experimentsPath(appName, platform);
  const expData = loadJSON(expPath, { active: [], killed: [], completed: [] });
  const killedFormats = new Set([
    ...((expData.killed || []).map(k => k.format)),
    ...((expData.completed || []).filter(c => c.outcome === 'killed' || c.outcome === 'auto-killed').map(c => c.format)),
  ]);

  for (const post of newPosts) {
    const text = post.text || post;
    if (!text || typeof text !== 'string') { skipped++; continue; }
    if (existing.has(text.toLowerCase())) {
      console.log(`  ⏭ Duplicate: "${text.substring(0, 60)}..."`);
      skipped++;
      continue;
    }

    // Reject killed experiment formats
    const postFormat = typeof post === 'object' ? post.format : null;
    if (postFormat && killedFormats.has(postFormat)) {
      console.log(`  ❌ Rejected: "${text.substring(0, 50)}..." — format "${postFormat}" was killed`);
      rejected++;
      continue;
    }

    // Reject formats not allowed on this platform
    if (postFormat && FORMAT_PLATFORMS[postFormat] && !FORMAT_PLATFORMS[postFormat].includes(platform)) {
      console.log(`  ❌ Rejected: "${text.substring(0, 50)}..." — format "${postFormat}" not allowed on ${platform}`);
      rejected++;
      continue;
    }

    // Reject non-AI formats in AI-generated pipeline (self-improve should never produce these)
    const { isAIGenerated } = require('../core/formats');
    const appConfig = paths.loadAppConfig(appName);
    if (appConfig?.pipelineType === 'ai-generated' && postFormat && !isAIGenerated(postFormat)) {
      console.log(`  ❌ Rejected: "${text.substring(0, 50)}..." — format "${postFormat}" is not AI-generated (pipelineType=ai-generated)`);
      rejected++;
      continue;
    }

    // Enforce char limits at write time
    const charError = typeof post === 'object' ? checkCharLimits(post, platform) : null;
    if (charError) {
      console.log(`  ❌ Rejected: "${text.substring(0, 50)}..." — ${charError}`);
      rejected++;
      continue;
    }

    // Validate format-specific fields (sceneAnchor vs slidePrompts, etc.)
    const formatError = typeof post === 'object' ? checkFormatFields(post, platform) : null;
    if (formatError) {
      console.log(`  ⚠️ Format warning: "${text.substring(0, 50)}..." — ${formatError}`);
      // Warning only, not rejection — fallback works but visual consistency suffers
    }

    if ((strategy.postQueue || []).length >= MAX_QUEUE) {
      console.log(`  ⚠️ Queue full (${MAX_QUEUE}) — stopping`);
      break;
    }

    const entry = typeof post === 'string' ? {
      text: post,
      source: 'agent-generated',
      addedAt: etDate(new Date()),
    } : {
      ...post,
      source: post.source || 'agent-generated',
      addedAt: post.addedAt || etDate(new Date()),
    };

    strategy.postQueue = strategy.postQueue || [];
    strategy.postQueue.unshift(entry);
    existing.add(text.toLowerCase());
    added++;
    console.log(`  ✅ Added: "${text.substring(0, 60)}..."`);
  }

  // Save strategy notes atomically with queue update
  if (effectiveNotes) {
    strategy.notes = effectiveNotes;
    strategy.notesUpdatedAt = new Date().toISOString();
    console.log(`  📝 Strategy notes saved (${effectiveNotes.length} chars)`);
  }

  // Save atomically
  saveJSON(strategyFile, strategy);
  const parts = [`${added} added`, `${skipped} skipped`];
  if (rejected > 0) parts.push(`${rejected} rejected`);
  console.log(`\n✅ Done: ${parts.join(', ')}. Queue: ${strategy.postQueue.length}/${MAX_QUEUE}`);

  // Note: experiment commands already applied BEFORE post processing (see above)

  // Save failure rules to platform failures.json
  if (effectiveFailures && effectiveFailures.length > 0) {
    const failPath = paths.failuresPath(appName, platform);
    const failData = loadJSON(failPath, { failures: [] });
    if (!failData.failures) failData.failures = [];
    const existingRules = new Set(failData.failures.map(f => typeof f === 'string' ? f : f.rule));
    let failAdded = 0;
    for (const rule of effectiveFailures) {
      const ruleText = typeof rule === 'string' ? rule : rule.rule;
      if (!ruleText || existingRules.has(ruleText)) continue;
      failData.failures.push({
        rule: ruleText,
        date: new Date().toISOString().split('T')[0],
        source: 'self-improve',
      });
      existingRules.add(ruleText);
      failAdded++;
    }
    if (failAdded > 0) {
      saveJSON(failPath, failData);
      console.log(`  🚫 ${failAdded} failure rules saved to ${platform}/failures.json`);
    }
  }

  // Save cross-platform insights (separate file, same operation)
  if (effectiveCrossNotes && platform) {
    const insightsFile = paths.insightsPath(appName);
    const insights = loadJSON(insightsFile, { lastUpdated: null });
    insights[platform] = effectiveCrossNotes;
    insights.lastUpdated = new Date().toISOString().split('T')[0];
    saveJSON(insightsFile, insights);
    console.log(`  🔗 Cross-platform insights saved for ${platform}`);
  }
}

main();
