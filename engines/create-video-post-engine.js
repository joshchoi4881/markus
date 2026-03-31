#!/usr/bin/env node
/**
 * Video Post Creation Engine
 *
 * Creates a Dropspace launch with a video file.
 * Used by schedule-day.js when the queue entry has format: 'video'.
 *
 * Usage:
 *   node create-video-post-engine.js --app <APP> --platform tiktok \
 *     --next [--schedule "2026-03-07T11:00:00-04:00"] [--publish] [--draft] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { dropspaceRequest: _dropspaceReq } = require('../core/api');
const { etDate, etHour, loadJSON, parseArgs, recordFailure: _recordFailure, recordError: _recordError, resolveApiKey, withGWSCredentials, TIMEOUTS } = require('../core/helpers');
const { resolveAccounts, buildTikTokSettings, publishAndVerify, dequeueAndRecord } = require('../core/launch');
const pathsLib = require('../core/paths');

const { getArg, hasFlag } = parseArgs();

const appName = getArg('app');
const platform = getArg('platform');
const shouldPublish = hasFlag('publish');
const draftMode = hasFlag('draft');
const scheduledDate = getArg('schedule');
const dryRun = hasFlag('dry-run');
const useNext = hasFlag('next');

if (!appName || !platform) {
  console.error('Usage: node create-video-post-engine.js --app <name> --platform <platform> --next [--schedule ISO]');
  process.exit(1);
}

const DROPSPACE_KEY = resolveApiKey(appName);
if (!DROPSPACE_KEY) {
  console.error('ERROR: Dropspace API key not set (check apiKeyEnv in app.json)');
  process.exit(1);
}

const strategyFilePath = pathsLib.strategyPath(appName, platform);
const failuresPath = pathsLib.failuresPath(appName, platform);
const postsPath = pathsLib.postsPath(appName, platform);
const appConfig = pathsLib.loadAppConfig(appName) || {};
const appPlatConfig = appConfig.platforms?.[platform] || {};

async function dropspaceAPI(method, endpoint, body = null) {
  return _dropspaceReq(method, endpoint, body, DROPSPACE_KEY);
}

/**
 * Generate a video via the configured provider (defaults to Fal.ai).
 *
 * @param {string} format - 'ugc-reaction' or 'ugc-talking'
 * @param {string} prompt - Video generation prompt (10-2000 chars)
 * @returns {string} Path to downloaded video file
 */
async function generateVideo(format, prompt) {
  const { resolveVideoGen } = require('../core/media-gen');
  const videoGen = resolveVideoGen(appConfig);

  const { FORMATS } = require('../core/formats');
  const fmtDef = FORMATS[format] || {};

  // Video formats use reactionDurationSeconds for the AI-generated clip length
  const durationSeconds = fmtDef.reactionDurationSeconds || fmtDef.videoDuration || 8;

  const tempDir = require('os').tmpdir();
  const tempPath = path.join(tempDir, `video-${Date.now()}.mp4`);

  await videoGen.generate(prompt, tempPath, durationSeconds);
  return tempPath;
}

(async () => {
  const strategy = loadJSON(strategyFilePath, { postQueue: [] });

  // Find next video post in queue (either with videoPath or video generation formats)
  let entry;
  if (useNext) {
    entry = (strategy.postQueue || []).find(h => {
      const e = typeof h === 'string' ? { text: h } : h;
      return (e.format === 'video' && e.videoPath) || 
             e.format === 'ugc-reaction' || 
             e.format === 'ugc-talking' ||
             e.false;
    });

    if (!entry) {
      // Fallback: try any post (could be a regular post)
      entry = (strategy.postQueue || []).find(h => !(h.text || h).startsWith('[AGENT:'));
    }

    if (!entry) {
      console.error('ERROR: --next specified but no usable posts in queue');
      process.exit(1);
    }
  }

  const text = entry.text || entry;
  const caption = entry.caption || text;
  const videoPath = entry.videoPath;
  const format = entry.format;

  console.log(`\n🎬 Creating video post for ${appName}/${platform}`);
  console.log(`   Text: "${text}"`);
  if (format) console.log(`   Format: ${format}`);

  // Check if this is a video generation format (Dropspace-generated videos)
  const isVideoGenFormat = format === 'ugc-reaction' || format === 'ugc-talking' || false;

  // If it's not a video post, delegate to the appropriate engine
  if (!videoPath && !isVideoGenFormat) {
    console.log('   Not a video post — delegating to standard engine');
    const { execSync } = require('child_process');
    const engine = path.join(__dirname, 'create-visual-post-engine.js');
    const textEngine = path.join(__dirname, 'create-text-post-engine.js');

    // Determine which engine based on platform type
    const { getPlatformDef } = require('../core/platforms');
    const platDef = getPlatformDef(platform);
    const enginePath = platDef.type === 'visual' ? engine : textEngine;

    const cmd = `node "${enginePath}" --app ${appName} --platform ${platform}${scheduledDate ? ` --schedule "${scheduledDate}"` : ''} --next`;
    try {
      const output = execSync(cmd, { encoding: 'utf-8', timeout: 300000, env: process.env });
      console.log(output);
    } catch (e) {
      console.error(e.stderr || e.message);
      process.exit(1);
    }
    return;
  }

  let finalVideoPath = videoPath;
  let tempVideoPath = null;
  // draftLaunchId removed — Fal.ai direct doesn't need draft launches

  // Handle video generation formats
  if (isVideoGenFormat) {
    console.log(`   🎬 Generating video via Dropspace (${format})`);
    
    const videoPrompt = entry.videoPrompt;
    
    if (!videoPrompt) {
      console.error(`❌ ${format} format requires videoPrompt field`);
      _recordFailure(failuresPath, `Missing videoPrompt for format ${format}`, { text });
      process.exit(1);
    }

    try {
      // Step 1: Generate video via Fal.ai directly (no draft launch needed)
      const generatedVideo = await generateVideo(format, videoPrompt);
      tempVideoPath = generatedVideo;
      finalVideoPath = generatedVideo;
      console.log(`   ✅ Generated: ${finalVideoPath}`);

      // UGC Reaction: stitch reaction clip with real demo clip
      // UGC formats: stitch generated clip with real demo clip
      const stitchFormats = ['ugc-reaction', 'ugc-talking'];
      if (stitchFormats.includes(format)) {
        const { FORMATS } = require('../core/formats');
        const fmtDef = FORMATS[format];
        const demoClip = appConfig?.demoClip || fmtDef?.demoClip;
        if (demoClip?.driveFileId) {
          console.log(`   🎬 Stitching with demo clip...`);
          const { execSync } = require('child_process');
          const os = require('os');

          // Download demo clip from Google Drive
          const demoPath = path.join(os.tmpdir(), `demo-clip-${Date.now()}.mp4`);
          try {
            await withGWSCredentials(async (credsFile, gEnv) => {
              execSync(
                `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE="${credsFile}" gws drive files get --params '{"fileId": "${demoClip.driveFileId}", "alt": "media"}' -o "${demoPath}"`,
                { timeout: TIMEOUTS.driveDownload, env: gEnv }
              );
            });
            console.log(`   ✅ Demo clip downloaded: ${demoPath}`);

            // Stitch: reaction clip + demo clip via FFmpeg concat
            const ffmpeg = path.join(process.env.HOME || '', 'bin', 'ffmpeg');
            const stitchedPath = path.join(os.tmpdir(), `stitched-${Date.now()}.mp4`);

            // Create concat file
            const concatFile = path.join(os.tmpdir(), `concat-${Date.now()}.txt`);
            fs.writeFileSync(concatFile, `file '${finalVideoPath}'\nfile '${demoPath}'\n`);

            // Re-encode both to common format then concat (preserve audio if present)
            const reactionScaled = path.join(os.tmpdir(), `reaction-scaled-${Date.now()}.mp4`);
            const demoScaled = path.join(os.tmpdir(), `demo-scaled-${Date.now()}.mp4`);

            const SCALE_FILTER = 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2';

            /**
             * Encode a clip to 1080x1920 H.264/AAC.
             * If the clip has no audio track, add a silent AAC track so concat works cleanly.
             */
            function encodeClipWithAudio(inputPath, outputPath) {
              try {
                // Try preserving audio (Veo 3.1 clips usually have audio)
                execSync(
                  `${ffmpeg} -i "${inputPath}" -vf "${SCALE_FILTER}" -r 30 -c:v libx264 -crf 23 -preset fast -c:a aac -ar 44100 -ac 2 -y "${outputPath}"`,
                  { timeout: TIMEOUTS.ffmpeg }
                );
              } catch {
                // No audio track — add silent audio so concat doesn't break
                execSync(
                  `${ffmpeg} -i "${inputPath}" -f lavfi -i anullsrc=r=44100:cl=stereo -vf "${SCALE_FILTER}" -r 30 -c:v libx264 -crf 23 -preset fast -map 0:v -map 1:a -c:a aac -ar 44100 -ac 2 -shortest -y "${outputPath}"`,
                  { timeout: TIMEOUTS.ffmpeg }
                );
              }
            }

            // Scale both to 1080x1920 (9:16), 30fps, same codec, with audio
            encodeClipWithAudio(finalVideoPath, reactionScaled);
            encodeClipWithAudio(demoPath, demoScaled);

            // Write updated concat file with scaled versions
            fs.writeFileSync(concatFile, `file '${reactionScaled}'\nfile '${demoScaled}'\n`);

            execSync(
              `${ffmpeg} -f concat -safe 0 -i "${concatFile}" -c copy -y "${stitchedPath}"`,
              { timeout: TIMEOUTS.ffmpeg }
            );

            console.log(`   ✅ Stitched: ${stitchedPath}`);

            // Cleanup intermediates
            try { fs.unlinkSync(concatFile); } catch {}
            try { fs.unlinkSync(reactionScaled); } catch {}
            try { fs.unlinkSync(demoScaled); } catch {}
            try { fs.unlinkSync(demoPath); } catch {}
            try { fs.unlinkSync(finalVideoPath); } catch {}

            finalVideoPath = stitchedPath;
            tempVideoPath = stitchedPath;
          } catch (e) {
            console.error(`   ⚠️ Demo clip stitch failed: ${e.message}`);
            console.log(`   ⏭ Using reaction clip only (no demo stitch)`);
            // Continue with just the reaction clip
            try { fs.unlinkSync(demoPath); } catch {}
          }
        }
      }
    } catch (e) {
      console.error(`❌ Video generation failed: ${e.message}`);
      _recordError(appName, platform, `Video generation failed: ${e.message}`, { text });
      process.exit(1);
    }
  } else {
    // Verify existing video file
    if (!fs.existsSync(videoPath)) {
      console.error(`❌ Video file not found: ${videoPath}`);
      _recordError(appName, platform, `Video file missing: ${videoPath}`, { text });
      process.exit(1);
    }
  }

  // Strip audio if format specifies noAudio (e.g. ugc-reaction — User swaps in trending music)
  if (isVideoGenFormat) {
    const { FORMATS } = require('../core/formats');
    const fmtDef = FORMATS[format] || {};
    if (fmtDef.noAudio) {
      const { execSync } = require('child_process');
      const ffmpeg = path.join(process.env.HOME || '', 'bin', 'ffmpeg');
      const noAudioPath = finalVideoPath.replace('.mp4', '-noaudio.mp4');
      console.log(`   🔇 Stripping audio (noAudio flag)...`);
      execSync(`${ffmpeg} -i "${finalVideoPath}" -an -c:v copy -y "${noAudioPath}"`, { timeout: TIMEOUTS.ffmpeg });
      try { fs.unlinkSync(finalVideoPath); } catch {}
      finalVideoPath = noAudioPath;
      tempVideoPath = noAudioPath;
    }
  }

  const stat = fs.statSync(finalVideoPath);
  const sizeMB = (stat.size / 1048576).toFixed(1);
  console.log(`   Video: ${finalVideoPath} (${sizeMB}MB)`);

  if (dryRun) {
    console.log(`\n🏃 Dry run — would create launch with video`);
    process.exit(0);
  }

  // Build media payload via Google Drive temp upload
  // Upload to Drive → make public → pass URL to Dropspace → cleanup after
  let media;
  let driveFileId = null;

  console.log(`   Uploading to Google Drive (temp)...`);
  try {
    const { execSync: _exec } = require('child_process');
    const videoTs = Date.now();
    await withGWSCredentials(async (credsFile, gEnv) => {
      // Upload file to Drive
      const uploadRes = JSON.parse(_exec(
        `gws drive files create --json '{"name": "dropspace_video_temp_${videoTs}.mp4"}' --upload "${finalVideoPath}"`,
        { encoding: 'utf-8', env: gEnv }
      ));
      driveFileId = uploadRes.id;
      console.log(`   ✅ Uploaded to Drive: ${driveFileId}`);

      // Make publicly accessible
      _exec(
        `gws drive permissions create --params '{"fileId": "${driveFileId}"}' --json '{"role": "reader", "type": "anyone"}'`,
        { encoding: 'utf-8', env: gEnv }
      );
    });

    const driveUrl = `https://drive.google.com/uc?export=download&id=${driveFileId}`;
    media = [{ source: 'url', url: driveUrl }];
    console.log(`   Upload method: Drive URL`);
  } catch (e) {
    console.error(`❌ Drive upload failed: ${e.message}`);
    _recordError(appName, platform, `Video Drive upload failed: ${e.message}`, { text });
    process.exit(1);
  }

  // Build platform_contents
  const platformContents = {};
  const platforms = [platform];

  for (const p of platforms) {
    const entry = { content: caption };
    if (p === 'tiktok') {
      entry.tiktok_settings = buildTikTokSettings(appPlatConfig);
    }
    platformContents[p] = entry;
  }

  // Create launch
  console.log('\n🚀 Creating Dropspace launch...');

  // Build user_platform_accounts from app.json connectionIds
  const { userPlatformAccounts, dropspacePlatforms } = resolveAccounts(appConfig, platforms);

  const launchBody = {
    title: text,
    product_description: appConfig.description || text,
    platforms,
    product_url: appConfig.url || null,
    media,
    media_attach_platforms: platforms,
    media_mode: 'video',
    platform_contents: platformContents,
  };

  if (Object.keys(userPlatformAccounts).length > 0) {
    launchBody.user_platform_accounts = userPlatformAccounts;
    console.log(`   Using connected accounts: ${Object.keys(userPlatformAccounts).join(', ')}`);
  }
  if (dropspacePlatforms.length > 0) {
    launchBody.dropspace_platforms = dropspacePlatforms;
  }

  if (scheduledDate) {
    // Normalize to UTC ISO string (Dropspace API rejects timezone offsets like -04:00)
    const parsedDate = new Date(scheduledDate);
    launchBody.scheduled_date = parsedDate.toISOString();
    console.log(`   📅 Scheduled for: ${launchBody.scheduled_date}`);
  }

  try {
    const launchRes = await dropspaceAPI('POST', '/launches', launchBody);
    if (launchRes.error || !launchRes.data?.id) {
      const errMsg = launchRes.error?.message || 'Launch creation failed';
      console.error(`   ❌ ${errMsg}`);
      _recordError(appName, platform, `Video launch failed: ${errMsg}`, { text });
      process.exit(1);
    }

    const launchId = launchRes.data.id;
    console.log(`   ✅ Launch created: ${launchId}`);

    // Publish / Schedule
    if (scheduledDate) {
      console.log(`\n📅 SCHEDULED — Launch ${launchId} will publish at ${scheduledDate}`);
    } else if (shouldPublish && !draftMode) {
      try {
        await publishAndVerify(DROPSPACE_KEY, launchId, platform,
          (err, ctx) => _recordError(appName, platform, err, ctx));
      } catch (e) {
        // Error already logged
      }
    } else {
      console.log(`\n📋 DRAFT — Launch ${launchId} ready`);
      console.log(`   Dashboard: https://www.dropspace.dev/launches/${launchId}`);
    }

    // Dequeue and update posts.json
    const extraFields = {
      caption,
      createdAt: new Date().toISOString(),
    };
    if (isVideoGenFormat) {
      extraFields.videoPrompt = entry.videoPrompt;
      extraFields.generatedVideo = true;
    } else {
      extraFields.videoPath = videoPath;
      extraFields.artist = entry.metadata?.artist || '';
      extraFields.event = entry.metadata?.event || '';
    }
    dequeueAndRecord(appName, platform, text, launchId, format || 'video', extraFields, strategyFilePath, postsPath);

    // Cleanup temp Drive file
    if (driveFileId) {
      try {
        const { execSync: _exec } = require('child_process');
        await withGWSCredentials(async (credsFile, gEnv) => {
          _exec(
            `gws drive files delete --params '{"fileId": "${driveFileId}"}'`,
            { encoding: 'utf-8', env: gEnv }
          );
        });
        console.log(`   🧹 Cleaned up temp Drive file`);
      } catch (e) {
        console.warn(`   ⚠️ Could not cleanup Drive file ${driveFileId}: ${e.message}`);
      }
    }

    // Cleanup temp video file if it was generated
    if (tempVideoPath && fs.existsSync(tempVideoPath)) {
      try {
        fs.unlinkSync(tempVideoPath);
        console.log(`   🧹 Cleaned up temp video file`);
      } catch (e) {
        console.warn(`   ⚠️ Could not cleanup temp video ${tempVideoPath}: ${e.message}`);
      }
    }

    console.log(`\n✨ Done! Launch ID: ${launchId}`);
  } catch (e) {
    console.error(`\n❌ Fatal: ${e.message}`);
    _recordError(appName, platform, `Video launch error: ${e.message}`, { text });
    process.exit(1);
  }
})();
