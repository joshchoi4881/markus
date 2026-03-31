#!/usr/bin/env node
/**
 * Main clip engine orchestrator.
 * Downloads from Drive, analyzes, cuts clips, and queues for distribution.
 *
 * Usage:
 *   # From Google Drive
 *   node clip-engine.js --app myapp --source <drive_file_id> \
 *     --event "Summer Sessions" --artist "DJ Phoenix" \
 *     [--max-clips 5] [--clip-duration 45] [--dry-run] [--auto]
 *
 *   # From local file
 *   node clip-engine.js --app myapp --file /path/to/video.mp4 \
 *     --event "Summer Sessions" --artist "DJ Phoenix"
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPTS = __dirname;
const SHARED = path.join(__dirname, '..', '..');

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}
function hasFlag(name) { return args.includes(`--${name}`); }

const appName = getArg('app');
const driveFileId = getArg('source');
const localFile = getArg('file');
const artist = getArg('artist') || '';
const event = getArg('event') || '';
const brand = getArg('brand') || 'Live Event';
const maxClips = parseInt(getArg('max-clips') || '5');
const clipDuration = parseInt(getArg('clip-duration') || '45');
const minGap = parseInt(getArg('min-gap') || '60');
const cropMode = getArg('crop') || 'center';
const platform = getArg('platform') || 'tiktok';
const dryRun = hasFlag('dry-run');
const autoQueue = hasFlag('auto');
const skipDriveBackup = hasFlag('no-drive');

if (!driveFileId && !localFile) {
  console.error('Usage: node clip-engine.js --app <name> --source <drive_file_id> --artist "..." --event "..."');
  console.error('   or: node clip-engine.js --app <name> --file /path/to/video.mp4 --artist "..." --event "..."');
  process.exit(1);
}

// Paths
const pathsLib = require(path.join(SHARED, 'core', 'paths'));
const appDir = pathsLib.appRoot(appName);
const clipOutputDir = path.join(appDir, platform, 'posts');
const sourcesDir = path.join(appDir, 'sources');
const clipsJsonPath = path.join(sourcesDir, 'clips.json');

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fallback; }
}
function saveJSON(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function formatTimestamp(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Drive backup helpers ──

function setupGWSAuth() {
  const credsFile = path.join(os.tmpdir(), `gws-creds-${process.pid}.json`);
  // Option 1: Direct credentials file
  if (process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE) {
    // Already set — skip 1Password loading
  } else if (process.env.GWS_VAULT_PATH) {
    // Option 2: 1Password
    const opToken = execSync(
      "grep OP_SERVICE_ACCOUNT_TOKEN ~/.bashrc | head -1 | cut -d'\"' -f2",
      { encoding: 'utf-8' }
    ).trim();
    const gwsVault = process.env.GWS_VAULT_PATH;
    try {
      execSync(
        `OP_SERVICE_ACCOUNT_TOKEN="${opToken}" op read 'op://${gwsVault}' > "${credsFile}"`,
        { encoding: 'utf-8' }
      );
      // Test auth with a simple API call
      process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE = credsFile;
      execSync(`gws drive about get --params '{"fields": "user"}' --format json`, {
        encoding: 'utf-8', timeout: 10000,
      });
      return credsFile;
    } catch {}
  }
  return null;
}

function createDriveFolder(name, parentId) {
  const body = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  const result = execSync(
    `gws drive files create --json '${JSON.stringify(body)}' --format json`,
    { encoding: 'utf-8', timeout: 15000 }
  );
  const parsed = JSON.parse(result);
  return parsed.id;
}

function uploadToDrive(filePath, parentId, fileName) {
  const result = execSync(
    `gws drive +upload "${filePath}" --parent "${parentId}"${fileName ? ` --name "${fileName}"` : ''}`,
    { encoding: 'utf-8', timeout: 120000 }
  );
  return JSON.parse(result);
}

/**
 * Find or create a "clips" subfolder inside the source Drive folder,
 * then upload all clips there with launch-name filenames.
 *
 * Folder structure: {source_folder}/clips/{launchName}.mp4
 * e.g. myapp/my-event/clips/clip-01.mp4
 *
 * @param {Array} clips - array of clip objects with {path, filename, launchName}
 * @param {string} sourceFolderId - Drive folder ID of the source event (from CONTEXT.md)
 */
async function backupClipsToDrive(clips, sourceFolderId) {
  if (!sourceFolderId) {
    console.log(`   ⚠️ No source Drive folder ID — skipping Drive backup`);
    return null;
  }

  const credsFile = setupGWSAuth();
  if (!credsFile) {
    console.log(`   ⚠️ GWS auth failed — skipping Drive backup (clips still local)`);
    return null;
  }

  try {
    // Find existing "clips" subfolder or create one
    const searchResult = execSync(
      `gws drive files list --params '{"q": "name = '\\''clips'\\'' and mimeType = '\\''application/vnd.google-apps.folder'\\'' and '\\''${sourceFolderId}'\\'' in parents and trashed = false", "fields": "files(id)"}' --format json`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const existing = JSON.parse(searchResult);
    let clipsFolderId;
    if (existing.files && existing.files.length > 0) {
      clipsFolderId = existing.files[0].id;
      console.log(`   📁 Using existing clips/ folder`);
    } else {
      clipsFolderId = createDriveFolder('clips', sourceFolderId);
      console.log(`   📁 Created clips/ folder`);
    }

    let uploaded = 0;
    for (const clip of clips) {
      if (!clip.path || !fs.existsSync(clip.path)) continue;
      const driveName = clip.launchName
        ? `${clip.launchName}.mp4`
        : clip.filename;
      try {
        uploadToDrive(clip.path, clipsFolderId, driveName);
        uploaded++;
        console.log(`   ☁️  Uploaded ${driveName}`);
      } catch (e) {
        console.error(`   ⚠️ Upload failed for ${driveName}: ${e.message?.slice(0, 100)}`);
      }
    }

    console.log(`   ✅ ${uploaded}/${clips.length} clips backed up to Drive`);
    try { fs.unlinkSync(credsFile); } catch {}
    return clipsFolderId;
  } catch (e) {
    console.error(`   ⚠️ Drive backup failed: ${e.message?.slice(0, 200)}`);
    try { fs.unlinkSync(credsFile); } catch {}
    return null;
  }
}

async function main() {
  console.log(`\n🎬 Clip Engine`);
  console.log(`   App: ${appName}`);
  console.log(`   Artist: ${artist || '(none)'}`);
  console.log(`   Event: ${event || '(none)'}`);
  console.log(`   Max clips: ${maxClips}, Duration: ${clipDuration}s`);
  if (dryRun) console.log(`   🏃 DRY RUN — no clips will be queued\n`);

  let sourcePath;
  let sourceCleanup = false;

  // ── Step 1: Get source video ──
  if (driveFileId) {
    console.log(`\n📥 Step 1: Downloading from Google Drive (${driveFileId})`);
    // Use home dir — /tmp is a small tmpfs (3.9GB), source videos can be 4-16GB
    const cacheDir = path.join(process.env.HOME, '.cache', 'clipper');
    fs.mkdirSync(cacheDir, { recursive: true });
    const tmpPath = path.join(cacheDir, `source-${driveFileId.slice(0, 8)}.mp4`);

    try {
      const output = execSync(
        `node "${path.join(SCRIPTS, 'source.js')}" --file-id "${driveFileId}" --output "${tmpPath}"`,
        { encoding: 'utf-8', timeout: 600000, env: process.env }
      );
      console.log(output);
      sourcePath = tmpPath;
      sourceCleanup = true;
    } catch (e) {
      console.error(`❌ Download failed: ${e.stderr?.slice(-500) || e.message}`);
      process.exit(1);
    }
  } else {
    console.log(`\n📂 Step 1: Using local file: ${localFile}`);
    if (!fs.existsSync(localFile)) {
      console.error(`❌ File not found: ${localFile}`);
      process.exit(1);
    }
    sourcePath = localFile;
  }

  // ── Step 2: Analyze ──
  console.log(`\n🔊 Step 2: Analyzing for highlight moments`);
  const analysisPath = path.join(os.tmpdir(), `clipper-analysis-${Date.now()}.json`);

  try {
    execSync(
      `node "${path.join(SCRIPTS, 'analyze.js')}" --input "${sourcePath}" --top ${maxClips} --min-gap ${minGap} --clip-duration ${clipDuration} --output "${analysisPath}"`,
      { encoding: 'utf-8', timeout: 300000, env: process.env, stdio: ['pipe', 'inherit', 'inherit'] }
    );
  } catch (e) {
    console.error(`❌ Analysis failed: ${e.message}`);
    if (sourceCleanup) try { fs.unlinkSync(sourcePath); } catch {}
    process.exit(1);
  }

  const candidates = JSON.parse(fs.readFileSync(analysisPath, 'utf-8'));
  fs.unlinkSync(analysisPath);

  if (candidates.length === 0) {
    console.log('⚠️ No clip-worthy moments found. Try adjusting --clip-duration or --min-gap.');
    if (sourceCleanup) try { fs.unlinkSync(sourcePath); } catch {}
    process.exit(0);
  }

  console.log(`\n   Found ${candidates.length} candidates`);

  // ── Step 3: Cut clips ──
  console.log(`\n✂️  Step 3: Cutting ${candidates.length} clips`);
  fs.mkdirSync(clipOutputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const clipsData = loadJSON(clipsJsonPath, { clips: [] });
  const generatedClips = [];

  for (const [i, candidate] of candidates.entries()) {
    const clipNum = i + 1;
    const clipFilename = `${timestamp}_clip${String(clipNum).padStart(2, '0')}.mp4`;
    const clipPath = path.join(clipOutputDir, clipFilename);
    // Launch name matches the naming convention used when creating Dropspace launches
    const launchName = event
      ? `${event} clip ${String(clipNum).padStart(2, '0')}`
      : `clip ${String(clipNum).padStart(2, '0')}`;

    console.log(`\n   Clip ${clipNum}/${candidates.length}: ${formatTimestamp(candidate.startSec)} → ${formatTimestamp(candidate.endSec)} (energy: ${(candidate.energy * 100).toFixed(0)}%)`);

    if (dryRun) {
      console.log(`   🏃 Would cut to: ${clipPath}`);
      generatedClips.push({ ...candidate, path: clipPath, filename: clipFilename, launchName });
      continue;
    }

    try {
      const cutArgs = [
        `--input "${sourcePath}"`,
        `--start ${candidate.startSec}`,
        `--duration ${candidate.durationSec}`,
        `--output "${clipPath}"`,
        artist ? `--artist "${artist}"` : '',
        event ? `--event "${event}"` : '',
        `--brand "${brand}"`,
        `--crop ${cropMode}`,
      ].filter(Boolean).join(' ');

      execSync(
        `node "${path.join(SCRIPTS, 'cut.js')}" ${cutArgs}`,
        { encoding: 'utf-8', timeout: 300000, env: process.env }
      );

      const stat = fs.statSync(clipPath);
      const clipMeta = {
        ...candidate,
        path: clipPath,
        filename: clipFilename,
        launchName,
        sizeMB: parseFloat((stat.size / 1048576).toFixed(1)),
        artist,
        event,
        sourceFileId: driveFileId || null,
        sourceFile: localFile || null,
        createdAt: new Date().toISOString(),
      };

      generatedClips.push(clipMeta);
      clipsData.clips.push(clipMeta);

      console.log(`   ✅ ${clipFilename} (${clipMeta.sizeMB}MB)`);
    } catch (e) {
      console.error(`   ❌ Clip ${clipNum} failed: ${e.message}`);
    }
  }

  // Save clips metadata
  if (!dryRun) {
    saveJSON(clipsJsonPath, clipsData);
  }

  // ── Step 3.5: Backup clips to Google Drive ──
  // Uploads clips into {source_folder}/clips/ so they live alongside the source footage
  if (!dryRun && !skipDriveBackup && generatedClips.length > 0) {
    console.log(`\n☁️  Step 3.5: Backing up clips to Google Drive`);
    // Resolve source Drive folder from event CONTEXT.md
    const contextPath = path.join(appDir, 'config', event?.replace(/\s+/g, '-').toLowerCase() || '', 'CONTEXT.md');
    let sourceFolderId = null;
    try {
      const ctx = fs.readFileSync(contextPath, 'utf-8');
      const folderMatch = ctx.match(/\*\*Google Drive folder:\*\*\s*`([^`]+)`/);
      if (folderMatch) sourceFolderId = folderMatch[1];
    } catch {}
    // Fallback: check if driveFileId's parent folder is available
    if (!sourceFolderId && driveFileId) {
      console.log(`   ⚠️ No Drive folder in CONTEXT.md — skipping Drive backup`);
    }
    await backupClipsToDrive(generatedClips, sourceFolderId);
  }

  // ── Step 4: Queue for distribution ──
  if (autoQueue && !dryRun && generatedClips.length > 0) {
    console.log(`\n📤 Step 4: Queuing ${generatedClips.length} clips for distribution`);

    for (const clip of generatedClips) {
      const hookText = artist
        ? `${artist} live at ${event || 'Live Event'} 🎵`
        : `Live at ${event || 'Live Event'} 🎵`;

      try {
        execSync(
          `node "${path.join(SCRIPTS, 'queue.js')}" --app ${appName} --platform ${platform} --video "${clip.path}" --text "${hookText}" --caption "Live performance | ${event}" --artist "${artist}" --event "${event}"`,
          { encoding: 'utf-8', env: process.env }
        );
      } catch (e) {
        console.error(`   ❌ Queue failed for ${clip.filename}: ${e.message}`);
      }
    }
  } else if (!autoQueue && generatedClips.length > 0) {
    console.log(`\n📋 Step 4: ${generatedClips.length} clips ready for review`);
    console.log(`   To queue manually:`);
    for (const clip of generatedClips) {
      console.log(`   node ${path.join(SCRIPTS, 'queue.js')} --app ${appName} --platform ${platform} --video "${clip.path}" --text "Your hook text" --caption "Your caption"`);
    }
  }

  // ── Cleanup source file ──
  if (sourceCleanup) {
    console.log(`\n🧹 Cleaning up source file (${(fs.statSync(sourcePath).size / 1048576).toFixed(0)}MB)`);
    fs.unlinkSync(sourcePath);
  }

  // ── Summary ──
  console.log(`\n✨ Done!`);
  console.log(`   Clips generated: ${generatedClips.length}`);
  console.log(`   Output dir: ${clipOutputDir}`);
  if (!autoQueue && generatedClips.length > 0) {
    console.log(`   ⚠️ Clips are NOT queued. Use --auto to auto-queue, or queue manually with queue.js`);
  }

  // Update inventory
  if (driveFileId && !dryRun) {
    const inventoryPath = path.join(sourcesDir, 'inventory.json');
    const inventory = loadJSON(inventoryPath, { events: [], processedClips: [] });

    // Mark source as processed
    for (const evt of inventory.events) {
      for (const a of (evt.artists || [])) {
        if (a.folderId === driveFileId) a.status = 'processed';
      }
    }

    inventory.processedClips.push({
      sourceFileId: driveFileId,
      artist, event,
      clipsGenerated: generatedClips.length,
      processedAt: new Date().toISOString(),
    });

    saveJSON(inventoryPath, inventory);
  }
}

main().catch(e => {
  console.error(`\n❌ Fatal: ${e.message}`);
  process.exit(1);
});

