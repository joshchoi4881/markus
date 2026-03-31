---
name: dropspace-dj-clipper
description: "Turn DJ sets and long music recordings into short-form TikTok/Instagram clips. Analyzes audio for energy peaks and transitions, cuts 30-second vertical clips, identifies songs via Whisper-based timestamping, generates captions with artist credits, schedules across platforms via Dropspace API. Use when asked to clip DJ sets, extract highlights from long recordings, or automate music content."
homepage: https://www.dropspace.dev/community/dropspace-dj-clipper
source: https://github.com/joshchoi4881/dropspace-agents
metadata:
  {
    "openclaw":
      {
        "emoji": "🎧",
        "requires": {
          "env": ["DROPSPACE_API_KEY", "ANTHROPIC_API_KEY"],
          "install": "git clone https://github.com/joshchoi4881/dropspace-agents && cd dropspace-agents && npm install",
          "system": ["ffmpeg"]
        }
      }
  }
---

# Dropspace DJ Clipper

Turn long DJ sets and music performances into short-form clips. Analyzes audio for transitions, cuts clips, credits every song, schedules across TikTok and Instagram.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/joshchoi4881/dropspace-agents && cd dropspace-agents && npm install
```

### 2. Run the setup wizard

```bash
node setup.js --template dropspace-dj-clipper
```

### 3. Set your API keys

```bash
export DROPSPACE_API_KEY="ds_live_..."     # from dropspace.dev/settings/api
export ANTHROPIC_API_KEY="sk-ant-..."       # from console.anthropic.com
```

Save in a `.env` file (copy from `templates/.env.example`). Add `.env` to `.gitignore` to avoid committing secrets.

### 4. Requirements

- **ffmpeg** — for audio analysis and video cutting (`~/bin/ffmpeg` or system install)
- **Source footage** — DJ set recordings (mp4/mov) on Google Drive or local disk
- **Tracklist** — song list in order (for accurate artist credits)

### 5. Configure

Edit `apps/myapp/app.json` (created by setup wizard):
- Set `integrations.googleDrive.folderId` if source footage is on Google Drive
- Set `pipelineType: "manual"`
- Configure platform connections (TikTok, Instagram)

## Usage

```bash
source .env

# Download source from Google Drive
node clipper/scripts/source.js --app myapp

# Analyze audio for transition points
node clipper/scripts/analyze.js --app myapp --source "path/to/set.mp4"

# Timestamp songs using Whisper
node clipper/scripts/timestamp-tracklist.js --app myapp

# Cut clips at transition points
node clipper/scripts/clip-transitions.js --app myapp

# Generate slideshows from clips (alternative to video clips)
node clipper/scripts/create-slideshows.js --app myapp

# Schedule clips for posting
node scripts/schedule-day.js --app myapp
```

## How It Works

1. **Analyze** — ffmpeg ebur128 loudness filter detects energy peaks. Multi-signal analysis: spectral flux, energy variance, bass shift, RMS energy. Ranks transitions by energy level.
2. **Timestamp** — Whisper transcribes vocal windows every 15 seconds. Matches lyrics against known tracklist to map each song to its start timestamp.
3. **Clip** — Cuts 30-second clips centered on each transition. Crops to 9:16 portrait. Encodes H.264 at CRF 23.
4. **Caption** — Auto-generates: "{song a} by {artist a} into {song b} by {artist b}" with links.
5. **Schedule** — Uploads to Dropspace as scheduled launches with configurable privacy (SELF_ONLY for sound swap workflow).

## Links

- Community page: https://www.dropspace.dev/community/dropspace-dj-clipper
- Case study: https://www.dropspace.dev/case-studies/march-2026
- Repo: https://github.com/joshchoi4881/dropspace-agents
