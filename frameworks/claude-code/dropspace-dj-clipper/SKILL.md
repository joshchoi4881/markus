---
name: dropspace-dj-clipper
description: "Extract short clips from DJ set recordings and schedule to TikTok/Instagram via Dropspace. Uses ffmpeg for audio analysis and video cropping. Use when asked to clip DJ sets, extract video highlights, or create short-form music content."
homepage: https://www.dropspace.dev/community/dropspace-dj-clipper
source: https://github.com/joshchoi4881/dropspace-agents
requires:
  env: [DROPSPACE_API_KEY]
  install: "git clone https://github.com/joshchoi4881/dropspace-agents && cd dropspace-agents && npm install"
  system: [ffmpeg]
---

# DJ Set Clipper

Extract 30-60 second transition clips from DJ set recordings. Auto-detect energy peaks, crop to vertical, schedule to TikTok + Instagram.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/joshchoi4881/dropspace-agents.git
cd dropspace-agents && npm install
```

### 2. Install ffmpeg

```bash
brew install ffmpeg    # macOS
# or: apt-get install ffmpeg   # Linux
```

### 3. Set your API keys

```bash
export DROPSPACE_API_KEY="ds_live_..."   # from dropspace.dev/settings/api
```

### 4. Initialize your app

```bash
node scripts/init-app.js --app myapp --platforms tiktok,instagram
```

### 5. Edit app.json

Open `apps/myapp/app.json` and fill in your event/artist details. Set up Google Workspace credentials for Drive access if videos are on Drive (see `templates/dropspace-dj-clipper/SETUP.md`).

### 6. Validate

```bash
node scripts/test-pipeline.js --app myapp
```

## Run the Clipper

```bash
# Process a DJ set video (local file)
node clipper/scripts/clip-engine.js --app myapp --source ~/videos/dj-set.mp4

# Or from Google Drive
node clipper/scripts/clip-engine.js --app myapp --source <DRIVE_FILE_ID> \
  --event "Summer Sessions" --artist "DJ Phoenix"

# Schedule extracted clips for posting
node scripts/schedule-day.js --app myapp
```

## What Happens

1. Downloads source video (if from Drive)
2. Analyzes audio to find energy peaks and transition points
3. Extracts 30-60 second clips at peak moments
4. Crops to 9:16 portrait for TikTok/Instagram
5. Generates captions with song names and artist credits
6. Queues clips for scheduling via Dropspace

## Supplementary Scripts

```bash
node clipper/scripts/analyze.js --file ~/videos/dj-set.mp4          # audio analysis only
node clipper/scripts/cut.js --file ~/videos/dj-set.mp4 --at 1234    # cut single clip at timestamp
node scripts/schedule-day.js --app myapp --dry-run                   # preview schedule
```

## Tips

- Start with 30-second clips. Adjust with `--duration 60` for longer.
- TikTok posts go to drafts (SELF_ONLY) so you can add trending audio before publishing.
- Process one set at a time to avoid mixing clips between events.

## Error Recovery

- Add `--dry-run` to any script to preview without saving
- `schedule-day.js` is idempotent — safe to re-run same day
