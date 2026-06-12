#!/usr/bin/env node
/**
 * Download a video file from Google Drive using gws CLI.
 * Handles credential loading from 1Password.
 *
 * Usage:
 *   node source.js --file-id <drive_id> --output /tmp/source.mp4
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}

const fileId = getArg('file-id');
// Use home dir for temp files — /tmp is a small tmpfs (3.9GB), source videos can be 4-16GB
const output = getArg('output') || path.join(process.env.HOME, '.cache', 'clipper', 'source.mp4');

if (!fileId) {
  console.error('Usage: node source.js --file-id <drive_id> --output /path/to/output.mp4');
  process.exit(1);
}

// Ensure output directory exists
fs.mkdirSync(path.dirname(output), { recursive: true });

async function main() {
  let credsFile = null;

  // Load GWS credentials
  // Option 1: Direct credentials file
  if (process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE) {
    // Already set — use directly
  } else if (process.env.GWS_VAULT_PATH) {
    // Option 2: Load from 1Password
    credsFile = path.join(os.tmpdir(), `gws-creds-${process.pid}.json`);
    const opToken = execSync(
      "grep OP_SERVICE_ACCOUNT_TOKEN ~/.bashrc | head -1 | cut -d'\"' -f2",
      { encoding: 'utf-8' }
    ).trim();
    execSync(
      `OP_SERVICE_ACCOUNT_TOKEN="${opToken}" op read 'op://${process.env.GWS_VAULT_PATH}' > "${credsFile}"`,
      { encoding: 'utf-8' }
    );
    process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE = credsFile;
  } else {
    throw new Error('Set GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE or GWS_VAULT_PATH');
  }

  try {
    // Get file metadata first
    const metaRaw = execSync(
      `gws drive files get --params '{"fileId": "${fileId}", "fields": "name,size,mimeType"}'`,
      { encoding: 'utf-8', env: process.env }
    );
    const meta = JSON.parse(metaRaw);
    const sizeMB = Math.round((parseInt(meta.size) || 0) / 1048576);
    console.log(`   File: ${meta.name} (${sizeMB}MB, ${meta.mimeType})`);

    // Download
    console.log(`   Downloading...`);
    execSync(
      `gws drive files get --params '{"fileId": "${fileId}", "alt": "media"}' -o "${output}"`,
      { encoding: 'utf-8', env: process.env, maxBuffer: 1024 * 1024 * 1024, timeout: 600000 }
    );

    const stat = fs.statSync(output);
    console.log(`   ✅ Downloaded: ${(stat.size / 1048576).toFixed(1)}MB`);

    // Output metadata for downstream scripts
    const result = {
      path: output,
      fileId,
      name: meta.name,
      size: stat.size,
      mimeType: meta.mimeType,
    };
    console.log(JSON.stringify(result));
  } finally {
    // Cleanup credentials
    if (credsFile) try { fs.unlinkSync(credsFile); } catch {}
  }
}

main().catch(e => {
  console.error(`❌ Download failed: ${e.message}`);
  process.exit(1);
});
