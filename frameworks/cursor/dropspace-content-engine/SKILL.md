---
description: "Self-improving content pipeline for Dropspace. Analyzes post performance, generates new content across 6 platforms, schedules publishing, and compounds strategy over time. Run nightly via Background Agent or Cursor Automations for best results."
globs: []
alwaysApply: false
requires:
  env: [DROPSPACE_API_KEY, ANTHROPIC_API_KEY, FAL_KEY]
  install: "git clone https://github.com/joshchoi4881/dropspace-agents && cd dropspace-agents && npm install"
---

# AI Content Engine

Self-improving content pipeline. Run two scripts nightly — posts get smarter over time.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/joshchoi4881/dropspace-agents.git
cd dropspace-agents && npm install
```

If `canvas` fails, that's fine — text-only formats still work. For visual formats: macOS `brew install pkg-config cairo pango`, Linux `apt install libcairo2-dev libpango1.0-dev`.

### 2. Set your API keys

```bash
export DROPSPACE_API_KEY="ds_live_..."   # from dropspace.dev/settings/api
export ANTHROPIC_API_KEY="sk-ant-..."           # from console.anthropic.com
export FAL_KEY="fal_..."                        # from fal.ai (for visual/video formats)
```

### 3. Initialize your app

Replace `myapp` with your app name. Add or remove platforms as needed.

```bash
node scripts/init-app.js --app myapp --platforms tiktok,twitter,linkedin,instagram,reddit,facebook
```

### 4. Edit app.json

Open `apps/myapp/app.json` and fill in:

- **name** — your product name
- **description** — one-sentence description
- **audience** — who you're targeting
- **problem** — the pain your product solves
- **url** — your product URL
- **voice** — writing style (e.g., "lowercase, casual, genuine")

### 5. Validate

```bash
node scripts/test-pipeline.js --app myapp
```

## Run the Pipeline

```bash
node scripts/run-self-improve-all.js --app myapp   # analyze + generate (up to 60 min)
node scripts/schedule-day.js --app myapp            # schedule for today (up to 40 min)
```

**Tip:** Enable YOLO mode (Settings > search "YOLO") and add `node scripts/*` to the allowlist so the agent runs commands without asking.

## What Happens Each Run

1. Pulls 14 days of analytics from Dropspace API
2. Identifies winning hooks (posts with >2x average engagement)
3. Kills underperforming format experiments
4. Generates 7-14 new posts with AI (text, visual, video formats)
5. Writes strategy notes to `apps/myapp/` (persists between runs)
6. Schedules posts across the day via Dropspace API

Each run reads the previous run's strategy notes. The loop compounds.

## Automate It

The full nightly cycle runs 4 scripts in order:

| Time | Script | What it does |
|------|--------|-------------|
| 12:00 AM | `refresh-tracking.js` + `cleanup-posts.js` | refresh analytics, clean old media |
| 12:30 AM | `run-x-research.js` | scan X/Twitter for trending hooks (optional) |
| 1:00 AM | `run-self-improve-all.js` | analyze performance, generate new posts |
| 2:00 AM | `schedule-day.js` | schedule generated posts for today |

### Option 1: Cursor Automations (recommended)

Set up Automations (Cursor Settings > Automations) with daily triggers for each script above. Each Automation runs a single command in the repo directory.

### Option 2: Background Agent

Cursor Background Agents run in a cloud sandbox. Create a Background Agent that clones the repo and runs all 4 scripts in sequence. Useful for one-off full pipeline runs.

### Option 3: System cron

```bash
crontab -e
# Full nightly schedule (replace paths and app name):
0  0 * * * cd /path/to/dropspace-agents && source .env && node scripts/refresh-tracking.js --app myapp && node scripts/cleanup-posts.js --app myapp --days 7 >> /tmp/dropspace-cron.log 2>&1
30 0 * * * cd /path/to/dropspace-agents && source .env && node scripts/run-x-research.js --app myapp >> /tmp/dropspace-cron.log 2>&1
0  1 * * * cd /path/to/dropspace-agents && source .env && node scripts/run-self-improve-all.js --app myapp >> /tmp/dropspace-cron.log 2>&1
0  2 * * * cd /path/to/dropspace-agents && source .env && node scripts/schedule-day.js --app myapp >> /tmp/dropspace-cron.log 2>&1
```

## MCP Server (optional)

For one-off operations (check analytics, retry a post), add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "dropspace": {
      "command": "npx",
      "args": ["-y", "@jclvsh/dropspace-mcp"],
      "env": { "DROPSPACE_API_KEY": "ds_live_..." }
    }
  }
}
```

**Important:** Quit and reopen Cursor after adding MCP config (loads at startup only).

## Supplementary Scripts

```bash
node scripts/refresh-tracking.js --app myapp          # update analytics cache
node scripts/cross-platform-report.js --app myapp     # generate insights report
node scripts/run-x-research.js --app myapp            # scan X/Twitter for trends (needs Bird CLI)
node scripts/cleanup-posts.js --app myapp --days 7    # clean old media assets
```

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
