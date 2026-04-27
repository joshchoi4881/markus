---
description: "Extract short clips from DJ set recordings and schedule to TikTok/Instagram via Dropspace. Uses ffmpeg for audio analysis and video cropping."
globs: []
alwaysApply: false
requires:
  env: [DROPSPACE_API_KEY]
  install: "git clone https://github.com/joshchoi4881/markus && cd markus && npm install"
  system: [ffmpeg]
---

# DJ Set Clipper

Extract 30-60 second transition clips from DJ set recordings. Auto-detect energy peaks, crop to vertical, schedule to TikTok + Instagram.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/joshchoi4881/markus.git
cd markus && npm install
brew install ffmpeg    # macOS (or apt-get install ffmpeg on Linux)
```

### 2. Set your API keys

```bash
export DROPSPACE_API_KEY="ds_live_..."   # from dropspace.dev/settings/api
```

### 3. Initialize and configure

```bash
node scripts/init-app.js --app myapp --platforms tiktok,instagram
```

Edit `apps/myapp/app.json` with your event/artist details. Set up Google Workspace credentials for Drive access if needed (see `templates/markus-dj-clipper/SETUP.md`).

### 4. Validate

```bash
node scripts/test-pipeline.js --app myapp
```

## Run

```bash
node clipper/scripts/clip-engine.js --app myapp --source ~/videos/dj-set.mp4
node scripts/schedule-day.js --app myapp
```

**Tip:** Enable YOLO mode and add `node clipper/*` and `node scripts/*` to the allowlist.

## Tips

- Start with 30-second clips. Adjust with `--duration 60`.
- TikTok posts go to drafts (SELF_ONLY) so you can add trending audio before publishing.
- Process one set at a time to avoid mixing clips between events.

## Error Recovery

- Add `--dry-run` to any script to preview without saving
- `schedule-day.js` is idempotent — safe to re-run same day
