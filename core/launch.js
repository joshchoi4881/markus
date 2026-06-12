/**
 * launch.js — Shared launch lifecycle helpers.
 *
 * Functions extracted from create-visual-post-engine.js, create-text-post-engine.js,
 * and create-video-post-engine.js to eliminate duplication.
 *
 * Provides:
 *   resolveAccounts(appConfig, platforms)
 *   buildTikTokSettings(appPlatConfig)
 *   publishAndVerify(dropspaceKey, launchId, platform, recordErrorFn)
 *   dequeueAndRecord(...)
 */

const fs = require('fs');
const path = require('path');
const { loadJSON, saveJSON, etDate, etHour } = require('./helpers');
const { verifyPublish, retryFailedPlatforms } = require('./api');

/**
 * Resolve user_platform_accounts and dropspace_platforms from app.json connectionIds.
 * Throws if a platform has no connectionId and useDropspacePlatform is not true.
 *
 * @param {object} appConfig - App config from app.json
 * @param {string[]} platforms - List of platform names
 * @returns {{ userPlatformAccounts: object, dropspacePlatforms: string[] }}
 */
function resolveAccounts(appConfig, platforms) {
  const userPlatformAccounts = {};
  const dropspacePlatforms = [];

  for (const p of platforms) {
    const pConfig = appConfig.platforms?.[p] || {};
    if (pConfig.connectionId) {
      userPlatformAccounts[p] = pConfig.connectionId;
    } else if (pConfig.useDropspacePlatform === true) {
      dropspacePlatforms.push(p);
    } else {
      const appName = appConfig.name || '(unknown app)';
      throw new Error(
        `Platform ${p} in app ${appName} has no connectionId and useDropspacePlatform is not explicitly enabled. ` +
        `Add connectionId to app.json platforms.${p} or set useDropspacePlatform: true.`
      );
    }
  }

  return { userPlatformAccounts, dropspacePlatforms };
}

/**
 * Build TikTok-specific settings object from app platform config.
 *
 * @param {object} appPlatConfig - Platform config from app.json (appConfig.platforms.tiktok)
 * @param {string} [privacyLevel] - Override privacy level (e.g. from config.tiktokPrivacyLevel)
 * @returns {object} tiktok_settings object
 */
function buildTikTokSettings(appPlatConfig, privacyLevel) {
  const defaults = appPlatConfig.tiktokSettings || {};
  return {
    privacy_level: privacyLevel || appPlatConfig.tiktokPrivacyLevel || 'PUBLIC_TO_EVERYONE',
    auto_add_music: defaults.auto_add_music ?? false,
    allow_comments: defaults.allow_comments ?? true,
    allow_duet: defaults.allow_duet ?? true,
    allow_stitch: defaults.allow_stitch ?? true,
    is_commercial: defaults.is_commercial ?? false,
    is_your_brand: defaults.is_your_brand ?? false,
    is_branded_content: defaults.is_branded_content ?? false,
  };
}

/**
 * Publish a launch and verify completion via polling.
 * Handles partial success by retrying failed platforms.
 *
 * @param {string} dropspaceKey - Dropspace API key
 * @param {string} launchId - Launch ID to publish
 * @param {string} platform - Primary platform name (for verification context)
 * @param {function} recordErrorFn - function(error, context) to log errors
 * @returns {Promise<object>} verification result from verifyPublish
 */
async function publishAndVerify(dropspaceKey, launchId, platform, recordErrorFn) {
  const { dropspaceRequest } = require('./api');

  console.log('\n📤 Publishing...\n');
  const pubRes = await dropspaceRequest('POST', `/launches/${launchId}/publish`, null, dropspaceKey);
  if (pubRes && pubRes.error) {
    const errMsg = pubRes.error.message || pubRes.error.code || 'Unknown publish error';
    console.error(`  ❌ Publish failed: ${errMsg}`);
    if (recordErrorFn) recordErrorFn(`Publish failed: ${errMsg}`, { launchId });
    const err = new Error(errMsg);
    err.launchId = launchId;
    throw err;
  }
  console.log('  ✅ Publish queued');

  const verification = await verifyPublish(dropspaceKey, launchId, platform);
  if (verification.postUrl) console.log(`  🔗 Post URL: ${verification.postUrl}`);

  if (verification.status === 'partial') {
    console.warn(`\n⚠️  Partial success — retrying failed platforms...`);
    const retry = await retryFailedPlatforms(dropspaceKey, launchId);
    if (retry.retried) console.log(`  🔄 Retrying: ${retry.platforms.join(', ')}`);
    else console.warn(`  ⚠️  Retry: ${retry.error}`);
  }

  if (!verification.ok || verification.warnings.length > 0) {
    console.warn(`\n⚠️  POST-PUBLISH WARNINGS:`);
    for (const w of verification.warnings) console.warn(`  ⚠️  ${w}`);
    if (recordErrorFn) recordErrorFn(`Partial publish: ${verification.warnings.join('; ')}`, { launchId });
  }

  return verification;
}

/**
 * Dequeue a hook from postQueue, update posts.json, and save meta.json.
 *
 * @param {string} appName
 * @param {string} platform
 * @param {string} hook - The hook text to dequeue
 * @param {string} launchId
 * @param {string} postFormat
 * @param {object} extraFields - Extra fields to merge into the posts.json entry
 * @param {string} strategyFilePath - Path to strategy.json
 * @param {string} postsFilePath - Path to posts.json
 */
function dequeueAndRecord(appName, platform, hook, launchId, postFormat, extraFields, strategyFilePath, postsFilePath) {
  // Update posts.json
  try {
    const postsData = loadJSON(postsFilePath, { posts: [] });
    const baseMetrics = {
      launchId,
      text: hook,
      format: postFormat,
      date: etDate(new Date()),
      hour: etHour(new Date()),
      lastChecked: new Date().toISOString(),
      ...extraFields,
    };
    const existingPost = postsData.posts.find(p => p.launchId === launchId);
    if (existingPost) {
      Object.assign(existingPost, baseMetrics);
    } else {
      postsData.posts.push(baseMetrics);
    }
    saveJSON(postsFilePath, postsData);
    console.log(`  ✅ Post saved to posts.json`);
  } catch (e) {
    console.warn(`  ⚠️ Could not update posts.json: ${e.message}`);
  }

  // Dequeue from postQueue
  try {
    const freshStrategy = loadJSON(strategyFilePath, {});
    const hookLower = hook.toLowerCase();
    const before = freshStrategy.postQueue?.length || 0;
    freshStrategy.postQueue = (freshStrategy.postQueue || []).filter(
      h => (h.text || h).toLowerCase() !== hookLower
    );
    saveJSON(strategyFilePath, freshStrategy);
    if (before > freshStrategy.postQueue.length) {
      console.log(`  ✅ Dequeued post from strategy.json (${freshStrategy.postQueue.length} remaining)`);
    }
  } catch (e) {
    console.warn(`  ⚠️ Could not dequeue hook: ${e.message}`);
  }
}

module.exports = {
  resolveAccounts,
  buildTikTokSettings,
  publishAndVerify,
  dequeueAndRecord,
};
