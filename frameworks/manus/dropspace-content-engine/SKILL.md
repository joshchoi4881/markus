# AI Content Engine

Self-improving content pipeline for Dropspace. Runs in Manus cloud sandbox with built-in scheduling.

**Requires:** `DROPSPACE_API_KEY`, `ANTHROPIC_API_KEY`, `FAL_KEY` (set in Manus Settings > Environment). Installs from [github.com/joshchoi4881/markus](https://github.com/joshchoi4881/markus).

## Setup

### 1. Clone and install

```bash
git clone https://github.com/joshchoi4881/markus.git
cd markus && npm install
```

### 2. Set API keys as Manus secrets

Store these in Manus Settings > Environment (server-side, not plaintext):

- `DROPSPACE_API_KEY` — from [dropspace.dev/settings/api](https://www.dropspace.dev/settings/api)
- `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com)
- `FAL_KEY` — from [fal.ai](https://fal.ai) (for visual/video formats)

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

## Schedule with Manus

Set up Scheduled Tasks (Manus Settings > Scheduled Tasks):

| Time | Task | What it does |
|------|------|-------------|
| 12:00 AM | `node scripts/refresh-tracking.js --app myapp && node scripts/cleanup-posts.js --app myapp --days 7` | refresh analytics, clean old media |
| 12:30 AM | `node scripts/run-x-research.js --app myapp` | scan X/Twitter for trending hooks (optional) |
| 1:00 AM | `node scripts/run-self-improve-all.js --app myapp` | analyze performance, generate new posts |
| 2:00 AM | `node scripts/schedule-day.js --app myapp` | schedule generated posts for today |

Split into separate tasks because of the 30-minute sandbox TTL (see caveats below). The x-research task is optional — skip if you don't have Bird CLI.

## What Happens Each Run

1. Pulls 14 days of analytics from Dropspace API
2. Identifies winning hooks (posts with >2x average engagement)
3. Kills underperforming format experiments
4. Generates 7-14 new posts with AI (text, visual, video formats)
5. Writes strategy notes to `apps/myapp/` (persists in sandbox)
6. Schedules posts across the day via Dropspace API

Each run reads the previous run's strategy notes. The loop compounds.

## Manus Caveats

- **Sandbox TTL (30 min):** Self-improve can take up to 60 min for 6 platforms. If it times out, reduce to 3-4 platforms per scheduled task, or split into per-platform tasks.
- **Credit cost:** Each run consumes ~500-900 credits. A daily cycle costs ~1000-1800 credits/day. Monitor in Settings.
- **Sandbox reset:** If the pipeline doesn't run for 7 days (free) or 21 days (paid), the sandbox resets. You lose `apps/` state (strategy notes, experiment tracking). Re-run `init-app.js` to recover — analytics history lives in Dropspace, not local files.

## Supplementary Scripts

```bash
node scripts/refresh-tracking.js --app myapp          # update analytics cache
node scripts/cross-platform-report.js --app myapp     # generate insights report
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
