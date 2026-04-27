---
name: markus-content-engine
description: "Self-improving content pipeline for Dropspace. Analyzes post performance, generates new content across 6 platforms, schedules publishing, and compounds strategy over time. Run nightly for best results. Use when asked to run the content engine, generate social posts, or manage the content pipeline."
homepage: https://www.dropspace.dev/community/markus-content-engine
source: https://github.com/joshchoi4881/markus
requires:
  env: [DROPSPACE_API_KEY, ANTHROPIC_API_KEY, FAL_KEY]
  install: "git clone https://github.com/joshchoi4881/markus && cd markus && npm install"
---

# AI Content Engine

Self-improving content pipeline. Run two scripts nightly — posts get smarter over time because the pipeline learns from real engagement data.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/joshchoi4881/markus.git
cd markus && npm install
```

If `canvas` fails to install, that's fine — text-only formats still work. For visual formats (TikTok/Instagram slideshows), install the system dependencies first: macOS `brew install pkg-config cairo pango`, Linux `apt install libcairo2-dev libpango1.0-dev`.

### 2. Set your API keys

```bash
export DROPSPACE_API_KEY="ds_live_..."   # from dropspace.dev/settings/api
export ANTHROPIC_API_KEY="sk-ant-..."           # from console.anthropic.com
export FAL_KEY="fal_..."                        # from fal.ai (for visual/video formats)
```

Save in a `.env` file (copy from `templates/.env.example`). Add `.env` to `.gitignore` to avoid committing secrets.

### 3. Initialize your app

Replace `myapp` with your app name. Add or remove platforms as needed.

```bash
node scripts/init-app.js --app myapp --platforms tiktok,twitter,linkedin,instagram,reddit,facebook
```

This creates `apps/myapp/` with config files and per-platform directories.

### 4. Edit app.json

Open `apps/myapp/app.json` and fill in:

- **name** — your product name
- **description** — one-sentence description
- **audience** — who you're targeting (e.g., "indie hackers, solo founders")
- **problem** — the pain your product solves
- **differentiator** — why you vs alternatives
- **url** — your product URL
- **voice** — writing style (e.g., "lowercase, casual, genuine")

### 5. Validate

```bash
node scripts/test-pipeline.js --app myapp
```

This checks: env vars present, API keys valid, app.json readable, and runs a dry self-improve cycle. All checks should pass before running the real pipeline.

## Run the Pipeline

The core loop — run these two commands:

```bash
# Analyze performance + generate new posts (up to 60 min)
node scripts/run-self-improve-all.js --app myapp

# Schedule generated posts for today (up to 40 min)
node scripts/schedule-day.js --app myapp
```

## What Happens Each Run

1. Pulls 14 days of analytics from Dropspace API
2. Identifies winning hooks (posts with >2x average engagement)
3. Kills underperforming format experiments
4. Generates 7-14 new posts with AI (text, visual, video formats)
5. Writes strategy notes to `apps/myapp/` (persists between runs)
6. Schedules posts across the day via Dropspace API

Each run reads the previous run's strategy notes. The loop compounds.

## Automate It

Set up system crons to run the full nightly cycle (replace paths and app name):

```bash
crontab -e

# Full nightly schedule (all times ET):
0  0 * * * cd /path/to/markus && source .env && node scripts/refresh-tracking.js --app myapp && node scripts/cleanup-posts.js --app myapp --days 7 >> /tmp/dropspace-cron.log 2>&1
30 0 * * * cd /path/to/markus && source .env && node scripts/run-x-research.js --app myapp >> /tmp/dropspace-cron.log 2>&1
0  1 * * * cd /path/to/markus && source .env && node scripts/run-self-improve-all.js --app myapp >> /tmp/dropspace-cron.log 2>&1
0  2 * * * cd /path/to/markus && source .env && node scripts/schedule-day.js --app myapp >> /tmp/dropspace-cron.log 2>&1
```

| Time | Script | What it does |
|------|--------|-------------|
| 12:00 AM | `refresh-tracking.js` + `cleanup-posts.js` | refresh analytics cache, clean old media |
| 12:30 AM | `run-x-research.js` | scan X/Twitter for trending hooks (optional, needs Bird CLI) |
| 1:00 AM | `run-self-improve-all.js` | analyze performance, generate new posts (up to 60 min) |
| 2:00 AM | `schedule-day.js` | schedule generated posts for today |

The x-research cron is optional — skip it if you don't have Bird CLI set up. The other 3 are the core pipeline.

Or run manually each day — the pipeline still compounds as long as you run it regularly.

## Content Formats

| Format | Type | Platforms |
|--------|------|-----------|
| story-slideshow | visual | TikTok, Instagram, Facebook |
| ugc-reaction | video | TikTok, Instagram |
| ugc-talking | video | TikTok, Instagram |
| text-single | text | Twitter/X |
| text-post | text | LinkedIn, Reddit, Facebook |

## Error Recovery

- Add `--dry-run` to any script to preview without saving
- `schedule-day.js` is idempotent — safe to re-run same day
- Failed platforms retry automatically on next self-improve run
- Check logs at `apps/myapp/reports/`
