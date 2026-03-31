#!/usr/bin/env node
/**
 * Shared Text Post Creation Engine
 *
 * Consolidates the text-only post pipeline used by Twitter, LinkedIn, and Reddit:
 *   resolve hook → validate → idempotency check → create launch → publish → verify → update hooks → dequeue
 *
 * Called directly via CLI with --app and --platform flags,
 * or programmatically via runCreateTextPost(config).
 *
 * Config shape:
 * {
 *   platform: string,                          // 'twitter' | 'linkedin' | 'reddit'
 *
 *   // CLI
 *   hookArgName: string,                       // CLI arg name for hook (default: 'hook'). Reddit uses 'title'.
 *   contentArgName: string,                     // CLI arg name for content (default: 'body')
 *   extraCliArgs: (getArg, hasFlag) => object, // parse extra CLI args (e.g. --format for Twitter)
 *
 *   // Validation
 *   validate: (hook, body, extra) => { errors: string[], warnings: string[] },
 *
 *   // Content parsing (e.g. Twitter thread splitting)
 *   parseContent: (hook, body, extra) => { body, parsed },  // optional transform
 *
 *   // Dropspace payload
 *   buildPlatformContents: (hook, body, parsed, extra) => object,
 *   buildLaunchPayload: (hook, body, appConfig, platformContents, extra) => object,  // optional override
 *
 *   // posts.json metrics
 *   postMetricFields: (extra) => object,
 *   postExtraFields: (hook, body, parsed, extra) => object,  // optional extra fields (format, tweetCount)
 *
 *   // Platform-specific behaviors
 *   preCreateCheck: (extra) => void,            // e.g. LinkedIn weekday warning
 *   dryRunDisplay: (hook, body, parsed, extra) => void,  // custom dry-run output
 * }
 */

const fs = require('fs');
const path = require('path');
const { dropspaceRequest: _dropspaceReq, checkDuplicate } = require('../core/api');
const { etTimestamp, loadJSON, saveJSON, parseArgs, recordFailure: _recordFailure, recordError: _recordError, buildCta, buildUtmUrl, resolveApiKey } = require('../core/helpers');
const { resolveAccounts, publishAndVerify, dequeueAndRecord } = require('../core/launch');
const pathsLib = require('../core/paths');
const { getPlatformDef } = require('../core/platforms');

function runCreateTextPost(config) {
  const { getArg, hasFlag } = parseArgs();

  const platform = config.platform || getArg('platform');
  const hookArgName = config.hookArgName || 'hook';

  // Merge config with platform registry if called directly
  if (!config.buildPlatformContents && platform) {
    const platDef = getPlatformDef(platform);
    config = { ...platDef, ...config };
  }
  const appName = getArg('app');
  let hookArg = getArg(hookArgName) || getArg('hook'); // always accept --hook as fallback
  const contentFile = getArg('content');
  const bodyArg = getArg(config.contentArgName || 'body');
  const shouldPublish = hasFlag('publish');
  const draftMode = hasFlag('draft');
  const scheduledDate = getArg('schedule');
  const dryRun = hasFlag('dry-run');
  const useNext = hasFlag('next');

  // Parse platform-specific extra CLI args
  const extra = config.extraCliArgs ? config.extraCliArgs(getArg, hasFlag) : {};

  if (!appName || !platform) {
    console.error(`Usage: node create-text-post-engine.js --app <name> --platform <platform> --${hookArgName} "..." [--body "..."] [--publish] [--next]`);
    process.exit(1);
  }

  const DROPSPACE_KEY = resolveApiKey(appName);

  if (!DROPSPACE_KEY && !dryRun) {
    console.error(`ERROR: Dropspace API key not set (check apiKeyEnv in app.json or set DROPSPACE_API_KEY)`);
    process.exit(1);
  }

  const appDir = pathsLib.platformDir(appName, platform);
  const strategyPath = pathsLib.strategyPath(appName, platform);
  const failuresFilePath = pathsLib.failuresPath(appName, platform);
  const postsFilePath = pathsLib.postsPath(appName, platform);

  const appConfig = pathsLib.loadAppConfig(appName) || {};
  
  const strategy = loadJSON(strategyPath, {});

  function recordFailure(rule, context = {}) {
    _recordFailure(failuresFilePath, rule, context);
  }
  function recordError(error, context = {}) {
    _recordError(appName, platform, error, context);
  }

  // ── Check failures ──
  if (fs.existsSync(failuresFilePath)) {
    const failures = loadJSON(failuresFilePath, { failures: [] });
    if (failures.failures?.length > 0) {
      console.log(`⚠️  ${failures.failures.length} failure rules to respect:`);
      for (const f of failures.failures) console.log(`  📌 ${f.rule}`);
    }
  }

  // ── Resolve hook ──
  let hook = hookArg;

  if (useNext && !hook) {
    if (!strategy.postQueue?.length) {
      console.error('❌ Post queue is empty. Run self-improve.js first.');
      process.exit(1);
    }
    const nextEntry = strategy.postQueue.find(h => !(h.text || h).startsWith('[AGENT:'));
    if (!nextEntry) {
      console.error('❌ No usable posts in queue.');
      process.exit(1);
    }
    hook = nextEntry.text || nextEntry;
    console.log(`🎣 Auto-picked post: "${hook}"`);
  }

  // Look up blueprint body from queue
  let blueprintBody = null;
  const { resolveDefaultFormat } = require('../core/formats');
  let postFormat = resolveDefaultFormat(appName, platform); // resolved from posting history
  {
    const hookLower = (hook || '').toLowerCase();
    const queueEntry = (strategy.postQueue || []).find(h => (h.text || '').toLowerCase() === hookLower);
    if (queueEntry && queueEntry.postBody) {
      console.log(`📋 Blueprint found in queue — using pre-generated post body`);
      blueprintBody = queueEntry.postBody;
    }
    if (queueEntry && queueEntry.format) {
      postFormat = queueEntry.format;
      // Propagate queue format to extra so parseContent/validate use it
      if (extra.format === 'auto' || !extra.format) {
        extra.format = queueEntry.format;
      }
    }
  }
  if (!hook) {
    console.error(`❌ No post provided. Use --${hookArgName} or --next.`);
    process.exit(1);
  }

  // ── Resolve body ──
  // Handle array postBody (e.g. Twitter threads stored as string[])
  let body = Array.isArray(blueprintBody) ? blueprintBody.join('\n\n') : (blueprintBody || '');
  if (contentFile) {
    if (!fs.existsSync(contentFile)) {
      console.error(`❌ Content file not found: ${contentFile}`);
      process.exit(1);
    }
    body = fs.readFileSync(contentFile, 'utf-8').trim();
  } else if (bodyArg) {
    body = bodyArg.trim();
  } else if (!body) {
    body = hook;
    console.log('⚠️  No --content or --body provided — using hook as content.');
  }

  // ── CTA Line Enforcement ──
  // Append BEFORE parseContent so CTA becomes part of thread splitting (last tweet)
  const cta = buildCta(config, appConfig, platform);
  if (cta && cta.text) {
    const bodyLower = body.toLowerCase();
    const appDomain = (appConfig.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
    const hasCta = (appDomain && bodyLower.includes(appDomain)) || bodyLower.includes(cta?.text?.toLowerCase() || '__none__');
    if (!hasCta) {
      body = body.trimEnd() + '\n\n' + cta.text;
      console.log(`  📣 Appended CTA: "${cta.text}"`);
    }
  }

  // ── Parse content (platform-specific transforms) ──
  let parsed = {};
  if (config.parseContent) {
    const result = config.parseContent(hook, body, extra);
    body = result.body || body;
    parsed = result.parsed || {};
  }

  // ── Platform-specific pre-create check ──
  if (config.preCreateCheck) {
    config.preCreateCheck(extra);
  }

  // ── Validation ──
  let hasErrors = false;
  if (config.validate) {
    const { errors, warnings } = config.validate(hook, body, parsed, extra);
    for (const w of warnings) console.warn(`⚠️  ${w}`);
    for (const e of errors) { console.error(`❌ ${e}`); hasErrors = true; }
  }

  if (body.length === 0) {
    console.error('❌ Body is empty');
    hasErrors = true;
  }

  if (hasErrors) {
    console.error('\n❌ Validation failed. Fix errors above.');
    process.exit(1);
  }

  console.log('✅ Validation passed\n');

  // ── Dry run ──
  if (dryRun) {
    if (config.dryRunDisplay) {
      config.dryRunDisplay(hook, body, parsed, extra);
    } else {
      console.log('--- DRY RUN ---');
      console.log(`Hook: ${hook}`);
      console.log(`Body (${body.length} chars):\n${body}`);
      console.log('--- END ---');
    }
    console.log('\n🏃 Dry run — no post created');
    process.exit(0);
  }

  // ── Build Dropspace payload ──
  const utmUrl = buildUtmUrl(appConfig, platform);

  const platformContents = config.buildPlatformContents(hook, body, parsed, extra);

  let launchPayload;
  if (config.buildLaunchPayload) {
    launchPayload = config.buildLaunchPayload(hook, body, appConfig, platformContents, extra);
  } else {
    // Resolve user_platform_accounts from app.json connectionIds
    const { userPlatformAccounts, dropspacePlatforms } = resolveAccounts(appConfig, [platform]);

    launchPayload = {
      title: hook,
      product_description: appConfig.description || hook,
      platforms: [platform],
      product_url: utmUrl,
      platform_contents: platformContents,
    };
    if (Object.keys(userPlatformAccounts).length > 0) {
      launchPayload.user_platform_accounts = userPlatformAccounts;
    }
    if (dropspacePlatforms.length > 0) {
      launchPayload.dropspace_platforms = dropspacePlatforms;
    }
  }
  if (scheduledDate) {
    launchPayload.scheduled_date = scheduledDate;
  }

  // ── Publish ──
  (async () => {
    console.log(`\n📝 Creating ${platform} post for ${appName}`);
    console.log(`   Hook: "${hook.substring(0, 80)}"`);
    console.log(`   Content: ${body.length} chars\n`);

    // Idempotency check
    const duplicate = await checkDuplicate(DROPSPACE_KEY, hook, platform);
    if (duplicate) {
      console.log(`\n⚠️ Launch already exists for this hook today: ${duplicate.id} (${duplicate.status})`);
      console.log('Skipping to avoid duplicate.');
      process.exit(0);
    }

    // Create launch
    console.log(`${shouldPublish && !draftMode ? '🚀 Publishing' : '📝 Creating draft'} via Dropspace...`);

    let result;
    try {
      result = await _dropspaceReq('POST', '/launches', launchPayload, DROPSPACE_KEY);
    } catch (e) {
      const errMsg = e.message || 'Launch creation failed';
      console.error(`❌ ${errMsg}`);
      recordError(`Launch creation failed: ${errMsg}`, { hook });
      process.exit(1);
    }

    const launchId = result.data?.id || result.id || 'unknown';
    console.log(`✅ Launch created: ${launchId}`);

    // Publish / Schedule
    if (scheduledDate) {
      console.log(`\n📅 SCHEDULED — Launch ${launchId} will publish at ${scheduledDate}`);
      console.log(`   Dashboard: https://www.dropspace.dev/launches/${launchId}`);
    } else if (shouldPublish && !draftMode) {
      try {
        await publishAndVerify(DROPSPACE_KEY, launchId, platform, recordError);
      } catch (e) {
        // Error already logged by publishAndVerify
      }
    } else {
      console.log(`📋 Draft created. Publish: curl -X POST https://api.dropspace.dev/launches/${launchId}/publish -H "Authorization: Bearer $DROPSPACE_API_KEY"`);
    }

    // ── Dequeue, update posts.json ──
    dequeueAndRecord(appName, platform, hook, launchId, postFormat, {
      postBody: body || null,
      ...(config.postMetricFields ? config.postMetricFields(extra) : {}),
      ...(config.postExtraFields ? config.postExtraFields(hook, body, parsed, extra) : {}),
    }, strategyPath, postsFilePath);

    // ── Save post metadata ──
    const postDir = path.join(appDir, 'posts', etTimestamp(new Date()));
    fs.mkdirSync(postDir, { recursive: true });
    const meta = {
      launchId,
      app: appName,
      hook,
      format: postFormat,
      platform,
      published: shouldPublish && !draftMode,
      createdAt: new Date().toISOString(),
      postDir,
      ...(config.postExtraFields ? config.postExtraFields(hook, body, parsed, extra) : {}),
    };
    fs.writeFileSync(path.join(postDir, 'meta.json'), JSON.stringify(meta, null, 2));

    console.log(`\n✨ Done! Launch ID: ${launchId}`);
  })().catch(e => {
    console.error(`❌ Fatal: ${e.message}`);
    process.exit(1);
  });
}

// CLI entrypoint — run directly with: node create-text-post-engine.js --app X --platform Y [--next] [--schedule ISO]
if (require.main === module) {
  runCreateTextPost({});
}

module.exports = { runCreateTextPost };
