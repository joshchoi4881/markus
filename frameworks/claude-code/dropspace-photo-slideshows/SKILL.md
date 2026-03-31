---
name: dropspace-photo-slideshows
description: "Turn event photos from Google Drive into TikTok/Instagram slideshows via Dropspace. Face-aware text positioning, community voice captions. Use when asked to create slideshows from event photos or manage photo-based social content."
homepage: https://www.dropspace.dev/community/dropspace-photo-slideshows
source: https://github.com/joshchoi4881/dropspace-agents
requires:
  env: [DROPSPACE_API_KEY]
  install: "git clone https://github.com/joshchoi4881/dropspace-agents && cd dropspace-agents && npm install"
  system: [ffmpeg]
---

# Event Photo Slideshows

Turn event photos from Google Drive into TikTok/Instagram slideshows with community voice captions.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/joshchoi4881/dropspace-agents.git
cd dropspace-agents && npm install
```

If `canvas` fails, install system deps first: macOS `brew install pkg-config cairo pango`, Linux `apt install libcairo2-dev libpango1.0-dev`. Then `npm install` again.

### 2. Set your API keys

```bash
export DROPSPACE_API_KEY="ds_live_..."   # from dropspace.dev/settings/api
```

### 3. Initialize your app

```bash
node scripts/init-app.js --app myapp --platforms tiktok,instagram
```

### 4. Edit app.json

Open `apps/myapp/app.json` and fill in your event/community details. Set up Google Workspace credentials for Drive access (see `templates/dropspace-photo-slideshows/SETUP.md`).

### 5. Validate

```bash
node scripts/test-pipeline.js --app myapp
```

## Create Slideshows

```bash
# Generate slideshows from Google Drive photos
node clipper/scripts/create-slideshows.js --app myapp

# Schedule for posting
node scripts/schedule-day.js --app myapp
```

## What Happens

1. Pulls photos from Google Drive folder
2. Selects best photos (3-8 per slideshow), mixing across subfolders
3. Resizes to 9:16 portrait, adds text overlays with face-aware positioning
4. Generates community voice captions
5. Tracks used photos to prevent duplicates
6. Queues slideshows for scheduling via Dropspace

## Tips

- 3 photos per slideshow works best for quick-scroll content
- Captions should feel authentic — avoid marketing language
- TikTok auto-adds music for better reach on slideshows
- Great for: music events, meetups, workshops, community gatherings

## Error Recovery

- Add `--dry-run` to any script to preview without saving
- `schedule-day.js` is idempotent — safe to re-run same day
