---
description: "Turn event photos from Google Drive into TikTok/Instagram slideshows via Dropspace. Face-aware text positioning, community voice captions."
globs: []
alwaysApply: false
requires:
  env: [DROPSPACE_API_KEY]
  install: "git clone https://github.com/joshchoi4881/markus && cd markus && npm install"
  system: [ffmpeg]
---

# Event Photo Slideshows

Turn event photos from Google Drive into TikTok/Instagram slideshows with community voice captions.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/joshchoi4881/markus.git
cd markus && npm install
```

If `canvas` fails, install system deps first: macOS `brew install pkg-config cairo pango`, Linux `apt install libcairo2-dev libpango1.0-dev`.

### 2. Set your API keys

```bash
export DROPSPACE_API_KEY="ds_live_..."   # from dropspace.dev/settings/api
```

### 3. Initialize and configure

```bash
node scripts/init-app.js --app myapp --platforms tiktok,instagram
```

Edit `apps/myapp/app.json` with your event details. Set up Google Workspace credentials for Drive access (see `templates/markus-photo-slideshows/SETUP.md`).

### 4. Validate

```bash
node scripts/test-pipeline.js --app myapp
```

## Run

```bash
node clipper/scripts/create-slideshows.js --app myapp
node scripts/schedule-day.js --app myapp
```

## Tips

- 3 photos per slideshow works best for quick-scroll content
- Captions should feel authentic — avoid marketing language
- TikTok auto-adds music for better reach on slideshows

## Error Recovery

- Add `--dry-run` to any script to preview without saving
- `schedule-day.js` is idempotent — safe to re-run same day
