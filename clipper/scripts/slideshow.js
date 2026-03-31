#!/usr/bin/env node
/**
 * Slideshow creator — downloads images from a Google Drive folder,
 * selects the best ones, and outputs them ready for the visual post engine.
 *
 * Usage:
 *   node slideshow.js --folder <drive_folder_id> --output <dir> [--count 6] [--shuffle]
 *   node slideshow.js --app myapp --platform instagram --output <dir>
 *
 * When --app is provided, reads contentSources.drive-slideshow config from app.json.
 *
 * Output:
 *   Writes selected images to <output>/slide1.jpg, slide2.jpg, ... slideN.jpg
 *   Prints JSON array of absolute paths to stdout for piping to add-posts.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Args ──
function getArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}
function hasFlag(name) { return process.argv.includes(`--${name}`); }

const appName = getArg('app');
const platform = getArg('platform');
const folderId = getArg('folder');
const outputDir = getArg('output');
const count = parseInt(getArg('count') || '6');
const shuffle = hasFlag('shuffle');
const offset = parseInt(getArg('offset') || '0');

// ── Resolve config ──
let driveFolderId = folderId;

if (appName && !driveFolderId) {
  const pathsLib = require(path.join(__dirname, '..', '..', 'core', 'paths'));
  const appConfig = pathsLib.loadAppConfig(appName);
  if (!appConfig) { console.error(`❌ No app.json for ${appName}`); process.exit(1); }

  const platConfig = appConfig.platforms?.[platform] || {};
  const sourceKey = platConfig.contentSource || 'drive-slideshow';
  const sourceConfig = appConfig.contentSources?.[sourceKey] || {};
  driveFolderId = sourceConfig.driveFolder;

  if (!driveFolderId) {
    console.error(`❌ No driveFolder in contentSources.${sourceKey} for ${appName}`);
    process.exit(1);
  }
}

if (!driveFolderId) {
  console.error('Usage: node slideshow.js --folder <drive_folder_id> --output <dir> [--count 6]');
  console.error('   or: node slideshow.js --app <name> --platform <platform> --output <dir>');
  process.exit(1);
}

if (!outputDir) {
  console.error('❌ --output <dir> is required');
  process.exit(1);
}

// ── GWS auth ──
function getGwsEnv() {
  const opToken = execSync("grep OP_SERVICE_ACCOUNT_TOKEN ~/.bashrc | head -1 | cut -d'\"' -f2", { encoding: 'utf-8' }).trim();
  const credsFile = path.join(require('os').tmpdir(), `gws-slideshow-${process.pid}.json`);
  execSync(`OP_SERVICE_ACCOUNT_TOKEN="${opToken}" op read 'op://${GWS_VAULT_PATH}' > "${credsFile}"`, { encoding: 'utf-8' });
  return { env: { ...process.env, GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE: credsFile }, credsFile };
}

function cleanupGws(credsFile) {
  try { fs.unlinkSync(credsFile); } catch {}
}

// ── List images in Drive folder ──
function listDriveImages(folderId, gEnv) {
  const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
  const query = `"${folderId}" in parents and (${imageTypes.map(t => `mimeType="${t}"`).join(' or ')}) and trashed=false`;

  const result = JSON.parse(execSync(
    `gws drive files list --params '${JSON.stringify({ q: query, fields: 'files(id,name,size,mimeType,createdTime)', pageSize: 100, orderBy: 'name' })}'`,
    { encoding: 'utf-8', env: gEnv }
  ));

  return (result.files || []).map(f => ({
    id: f.id,
    name: f.name,
    size: parseInt(f.size || '0'),
    mimeType: f.mimeType,
    createdTime: f.createdTime,
  }));
}

// ── List subfolders (for recursive scanning) ──
function listSubfolders(folderId, gEnv) {
  const query = `"${folderId}" in parents and mimeType="application/vnd.google-apps.folder" and trashed=false`;
  const result = JSON.parse(execSync(
    `gws drive files list --params '${JSON.stringify({ q: query, fields: 'files(id,name)', pageSize: 100 })}'`,
    { encoding: 'utf-8', env: gEnv }
  ));
  return result.files || [];
}

// ── Download image from Drive ──
function downloadImage(fileId, destPath, gEnv) {
  execSync(
    `gws drive files download --params '{"fileId": "${fileId}"}' -o "${destPath}"`,
    { encoding: 'utf-8', env: gEnv }
  );
}

// ── Main ──
(async () => {
  console.log(`📸 Slideshow: scanning Drive folder ${driveFolderId}...`);

  const { env: gEnv, credsFile } = getGwsEnv();

  try {
    // Scan for images (including subfolders)
    let allImages = listDriveImages(driveFolderId, gEnv);
    const subfolders = listSubfolders(driveFolderId, gEnv);

    for (const sub of subfolders) {
      const subImages = listDriveImages(sub.id, gEnv);
      allImages = allImages.concat(subImages.map(img => ({ ...img, subfolder: sub.name })));
    }

    console.log(`   Found ${allImages.length} images${subfolders.length ? ` across ${subfolders.length + 1} folders` : ''}`);

    if (allImages.length === 0) {
      console.error('❌ No images found in Drive folder');
      process.exit(1);
    }

    // Select images
    let selected;
    if (shuffle) {
      // Random selection
      const shuffled = [...allImages].sort(() => Math.random() - 0.5);
      selected = shuffled.slice(0, count);
    } else {
      // Sequential from offset (for deterministic batch processing)
      selected = allImages.slice(offset, offset + count);
    }

    if (selected.length < count) {
      console.warn(`   ⚠️ Only ${selected.length} images available (requested ${count})`);
    }

    // Download selected images
    fs.mkdirSync(outputDir, { recursive: true });
    const downloadedPaths = [];

    for (let i = 0; i < selected.length; i++) {
      const img = selected[i];
      const ext = img.mimeType === 'image/png' ? 'png' : 'jpg';
      const destPath = path.join(outputDir, `slide${i + 1}.${ext}`);

      console.log(`   📥 ${i + 1}/${selected.length}: ${img.name}${img.subfolder ? ` (${img.subfolder})` : ''}`);
      downloadImage(img.id, destPath, gEnv);
      downloadedPaths.push(path.resolve(destPath));
    }

    console.log(`\n✅ ${downloadedPaths.length} images downloaded to ${outputDir}`);

    // Output paths as JSON for piping
    console.log('\n' + JSON.stringify(downloadedPaths));

  } finally {
    cleanupGws(credsFile);
  }
})();
