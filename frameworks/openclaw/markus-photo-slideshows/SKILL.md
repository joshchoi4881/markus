---
name: markus-photo-slideshows
description: "Turn event photos into daily TikTok/Instagram slideshows. Downloads photos from Google Drive, resizes for mobile, assembles slideshows with face-aware text overlays, generates captions in a configurable community voice, schedules one post per day via Dropspace API. Use when asked to automate event photo posting, create slideshows from Google Drive, or schedule photo content."
homepage: https://www.dropspace.dev/community/markus-photo-slideshows
source: https://github.com/joshchoi4881/markus
metadata:
  {
    "openclaw":
      {
        "emoji": "📸",
        "requires": {
          "env": ["DROPSPACE_API_KEY"],
          "install": "git clone https://github.com/joshchoi4881/markus && cd markus && npm install",
          "system": ["ffmpeg"]
        }
      }
  }
---

# Event Photo Slideshows

Turn event photos from Google Drive into daily TikTok/Instagram slideshows. Upload photos, the pipeline handles the rest — resizing, text overlays, captions, scheduling.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/joshchoi4881/markus && cd markus && npm install
```

For image processing: macOS `brew install pkg-config cairo pango`, Linux `apt install libcairo2-dev libpango1.0-dev`, then `npm install` again.

### 2. Run the setup wizard

```bash
node setup.js --template markus-photo-slideshows
```

### 3. Set your API keys

```bash
export DROPSPACE_API_KEY="ds_live_..."     # from dropspace.dev/settings/api
```

For Google Drive access, configure GWS credentials (see `templates/markus-photo-slideshows/SETUP.md`).

Save in a `.env` file (copy from `templates/.env.example`). Add `.env` to `.gitignore` to avoid committing secrets.

### 4. Configure

Edit `apps/myapp/app.json` (created by setup wizard):
- Set `pipelineType: "manual"`
- Set `integrations.googleDrive.folderId` to your Google Drive folder
- Configure platform connections (TikTok, Instagram)
- Set posting time and community voice

### 5. Upload photos

Upload event photos to the configured Google Drive folder. Supported formats: jpg, png, webp.

## Usage

```bash
source .env

# Generate slideshows from Drive photos (downloads, resizes, uploads to Dropspace)
node clipper/scripts/create-slideshows.js --app myapp

# Check what's scheduled
node scripts/daily-schedule-report.js --app myapp

# Schedule for posting
node scripts/schedule-day.js --app myapp
```

## How It Works

1. **Download** — Fetches photos from Google Drive folder via GWS CLI
2. **Resize** — Scales to 1080x1920 (9:16) for mobile via ffmpeg
3. **Overlay** — Renders text overlays with node-canvas. Face-aware positioning — text avoids covering faces
4. **Group** — Assembles into slideshows (10-15 photos each)
5. **Upload** — Uploads as base64 to Dropspace with scheduled dates
6. **Schedule** — One slideshow posts per day at configured time

## Automation

Once slideshows are generated, schedule posting:

```bash
# Daily schedule check
node scripts/daily-schedule-report.js --app myapp

# Queue refill — run create-slideshows.js again when queue is low
node clipper/scripts/create-slideshows.js --app myapp
```

Requires ffmpeg for image resizing (`~/bin/ffmpeg` or system install).

## Links

- Community page: https://www.dropspace.dev/community/markus-photo-slideshows
- Case study: https://www.dropspace.dev/case-studies/march-2026
- Repo: https://github.com/joshchoi4881/markus
