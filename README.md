# markus — Automation Pipeline Core

All social media automations use this shared library. Supports multiple apps with two pipeline types:

- **ai-generated** — full pipeline: self-improve → AI post generation → scheduling → publishing
- **manual** — pre-built launches with `launchId` in queue; schedule only, no AI engine

Platform-specific behavior is defined in `platforms.js` (config registry) and `app.json` (per-app config). No per-platform scripts needed.


## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/joshchoi4881/markus.git
cd markus
npm install

# canvas is optional — only needed for visual formats (TikTok/Instagram slideshows).
# If it fails to install, text-only formats still work fine.
# To install canvas manually (requires system deps):
# macOS:  brew install pkg-config cairo pango libpng jpeg giflib librsvg && npm install canvas
# Ubuntu: sudo apt install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev && npm install canvas

# 2. Set up environment (pick one)
# Option A: Shell script
cp templates/load-env.example.sh load-env.sh
# Edit load-env.sh, then: source load-env.sh

# Option B: .env file
cp templates/.env.example .env
# Edit .env, then: source .env

# 3. Pick a template and run setup
node setup.js --list-templates
node setup.js --template dropspace-content-engine

# 4. Validate your setup
source load-env.sh  # or: source .env
node scripts/test-pipeline.js --app myapp
```

### Credentials

**Required for all templates:**
- `DROPSPACE_API_KEY` — get from [dropspace.dev/settings](https://www.dropspace.dev/settings)
- `ANTHROPIC_API_KEY` — for text generation

**For visual/video formats (TikTok, Instagram):**
- `FAL_KEY` — for image/video generation via [fal.ai](https://fal.ai)

**For clipper/slideshow templates (Google Drive access):**
- Option A: Set `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE` to your GWS credentials JSON path
- Option B: Set `GWS_VAULT_PATH` for 1Password-based credential loading

**For X/Twitter research + fact-checking (recommended):**
- [Bird CLI](https://github.com/steipete/bird) — `npm install -g @nicepkg/bird` or `brew install steipete/formulae/bird`
- Export browser cookies: `BIRD_AUTH_TOKEN` and `BIRD_CT0`
- Used for: x-research cron (trending hooks) AND self-improve fact-checking (verifying claims about recent events/people before posting)
- Without Bird: x-research is skipped, and fact-checking falls back to web_search only (less current for Twitter-specific topics)

**For Slack notifications (optional):**
- `SLACK_BOT_TOKEN` — Slack bot token (`xoxb-...`). Scripts send reports directly to each app's configured Slack channel after runs complete.
- Configure `notifications.slackChannel` in each app's `app.json` with the target channel ID.
- Without this: scripts still run fine, reports just go to stdout only (cron agent can still relay if configured).

## App Configuration

All app config is centralized in `~/markus/apps/{app}/app.json`.

> **Custom data directory:** Set `APPS_DATA_ROOT` to override the default `~/markus/apps/` location. All scripts use this for path resolution.

Example:

```json
{
  "name": "dropspace",
  "pipelineType": "ai-generated",
  "notifications": { "channel": "slack", "target": "YOUR_CHANNEL_ID" },
  "skipDays": [],
  "platforms": {
    "tiktok": {
      "enabled": true,
      "postingTimes": ["08:00", "13:00", "18:00"],
      "weekdaysOnly": false
    }
  },
  "integrations": { "supabase": {}, "stripe": {}, "posthog": {} }
}
```

Key fields:
- **pipelineType**: `ai-generated` or `manual`
- **notifications**: `{channel, target}` for cron delivery (supports slack, telegram, discord, etc.)
- **skipDays**: Array of day numbers (0=Sunday, 6=Saturday) to skip all posting

## Layout

```
~/markus/apps/
├── dropspace/                             # App: Dropspace (ai-generated)
│   ├── app.json                           # App identity + integrations + platform config
│   ├── shared-failures.json               # Cross-platform directive failure rules
│   ├── insights.json                      # Cross-platform strategy notes
│   ├── x-research-signals.json            # Latest X research
│   ├── reports/                           # Cross-platform analysis reports
│   ├── tiktok/
│   │   ├── strategy.json                  # Queue, notes (posting times in app.json)
│   │   ├── posts.json                     # Historical performance
│   │   ├── failures.json                  # Directive failure rules
│   │   ├── experiments.json               # Format experiment tracking
│   │   ├── pending-batches.json           # (visual only)
│   │   └── posts/                         # Image assets
│   ├── instagram/
│   ├── facebook/
│   ├── twitter/
│   ├── linkedin/
│   └── reddit/
├── myapp/                                # App: Your App
├── cache/                                 # Shared API response cache
└── node_modules/                          # Shared deps (canvas)
```

## Scripts

```
~/markus/
├── core/
│   ├── paths.js                   # Single source of truth for all path resolution
│   ├── platforms.js               # Platform config registry (replaces 27 wrapper scripts)
│   ├── helpers.js                 # Timezone, JSON I/O, CLI parsing, referrer mapping
│   ├── api.js                     # Dropspace, Stripe, Supabase, PostHog, Sentry, GA4 API clients
│   ├── formats.js                 # Format registry (FORMATS + FORMAT_PLATFORMS) with generator types
│   │                              #   Generator types: ai-visual, ai-text, ai-video,
│   │                              #   drive-photos, drive-clips, manual
│   ├── correlations.js            # Data-driven failure detection (replaces text failure rules)
│   ├── launch.js                  # Publish + verify + dequeue helpers
│   ├── media-gen.js               # Image/video generation (fal, replicate, openai)
│   ├── overlay.js                 # Canvas text overlay
├── engines/
│   ├── self-improve-engine.js     # Analytics + strategy optimization
│   ├── create-visual-post-engine.js  # Image gen → overlay → compress → upload (TikTok, IG, FB)
│   ├── create-text-post-engine.js    # Text post → upload (Twitter, LinkedIn, Reddit)
│   └── create-video-post-engine.js   # Video post → Drive upload → Dropspace
├── scripts/
│   ├── schedule-day.js            # Schedule all posts for the day in one pass
│   │                              #   Pre-configured posts: PATCH launchId with scheduled date
│   │                              #   AI-generated posts: run engine to create + schedule
│   ├── add-posts.js               # Atomically add posts + strategy notes to queue
│   ├── run-x-research.js          # X/Twitter research via Bird CLI
│   ├── run-self-improve-all.js    # Run all ai-generated apps with auto-retry on failure
│   ├── cleanup-posts.js           # Remove old post image assets
│   ├── cross-platform-report.js   # Cross-platform analysis
│   ├── midnight-report.js         # Data report for midnight ops
│   ├── init-app.js                # Scaffold a new app (dirs + templates)
│   ├── daily-schedule-report.js   # Today's schedule summary
│   ├── refresh-tracking.js        # Pull analytics into TRACKING.md
│   ├── refresh-context.js         # Refresh context files
│   ├── setup-crons.js             # Print cron configuration
│   ├── list-templates.js          # List available templates
│   └── test-pipeline.js           # End-to-end pipeline test
├── docs/
│   ├── CRON_RULES.md              # Self-healing protocol + pipeline architecture
│   └── ANTI-PATTERNS.md           # Banned AI writing patterns
├── load-env.sh                    # Load env vars (copy from templates/load-env.example.sh)
└── README.md
```

## Script Invocation

All scripts use `--app` and `--platform` (where applicable):

```bash
# Self-improve for a platform
node engines/self-improve-engine.js --app dropspace --platform tiktok --days 14

# Create a visual post
node engines/create-visual-post-engine.js --app dropspace --platform tiktok --next --schedule "2026-03-04T12:00:00Z"

# Create a text post
node engines/create-text-post-engine.js --app dropspace --platform twitter --next --schedule "2026-03-04T14:30:00Z"

# Schedule all posts for the day
node scripts/schedule-day.js --app dropspace

# Add posts to queue
echo '{"posts":[...], "notes":"...", "crossNotes":"..."}' | node scripts/add-posts.js --app dropspace --platform tiktok

# Initialize a new app
node scripts/init-app.js --app myapp --platforms tiktok,instagram,twitter
```

## Daily Cron Flow (per app)

```
12:00 AM  midnight              → Monitoring, reports, maintenance, image cleanup
12:30 AM  x-research            → Bird CLI scans X → x-research-signals.json
 1:00 AM  self-improve-all      → All ai-generated apps/platforms in one session. Analyze + generate posts + fact-check via web_search/bird.
 2:00 AM  schedule-day          → Create all posts via Dropspace
                                   ai-generated: run engines on-demand
                                   manual: PATCH launchId with scheduled date
 7AM-7PM  Dropspace publishes   → Webhook → Slack report
Ongoing   Analytics cron         → Detects post deletions → post.deleted webhook → Slack
```

## Adding a New App

```bash
# 1. Scaffold
node ~/markus/scripts/init-app.js --app myapp --platforms tiktok,instagram,twitter

# 2. Configure
vim ~/markus/apps/myapp/app.json  # Fill in: pipelineType, notifications, skipDays, integrations, posting times

# 3. Add crons (stagger times so they don't overlap with existing apps)
```

## Pre-configured Pipeline Flow

For apps with `pipelineType: "manual"` (e.g. Community Events):

1. Queue entries are added with a `launchId` — the launch already exists in Dropspace (e.g. created by the clipper skill)
2. `schedule-day.js` PATCHes each launch with a `scheduled_date` instead of running an AI engine
3. `self-improve-engine.js` is skipped (no AI content generation needed)
4. Analytics still flow back via Dropspace webhooks → posts.json

## Framework Setup Guides

See `frameworks/` for install instructions tailored to specific AI tools: OpenClaw, Claude Code, Cursor, and Manus.
