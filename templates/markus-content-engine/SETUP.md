# Setup — AI Content Engine

## Prerequisites

### 1. Dropspace Account + API Key
- Sign up at [dropspace.dev](https://www.dropspace.dev)
- Go to Settings → API Keys → Create Key
- Scopes needed: `read`, `write`, `generate`, `publish`
- Save as `DROPSPACE_API_KEY` environment variable

### 2. Anthropic API Key
- Sign up at [console.anthropic.com](https://console.anthropic.com)
- Create an API key
- Save as `ANTHROPIC_API_KEY` environment variable
- Used for: text generation (hooks, captions, slide texts, strategy notes)

### 3. Image Generation API Key
- **Fal.ai (recommended):** Sign up at [fal.ai](https://fal.ai), create an API key, save as `FAL_KEY`
- Used for: TikTok slideshows, Instagram carousels, visual content
- Cost: ~$0.08/image (nano-banana-2 model)
- Also used for video formats (ugc-reaction, ugc-talking via Veo 3.1) if activated

### 4. Bird CLI (recommended — X/Twitter research + fact-checking)
- [Bird CLI](https://github.com/steipete/bird) — `npm install -g @nicepkg/bird` or `brew install steipete/formulae/bird`
- Export browser cookies from X/Twitter: `BIRD_AUTH_TOKEN` and `BIRD_CT0`
- Used for: x-research cron (trending hooks) AND fact-checking generated posts before they enter the queue
- The self-improve cron uses Bird to verify claims about real events and people before saving posts. Without it, fact-checking falls back to web search only (less current for Twitter-specific topics).
- Cookies expire periodically — re-export from your browser when searches fail

### 5. FFmpeg (optional — required for video formats)
- Install: `apt install ffmpeg` (Linux) or `brew install ffmpeg` (macOS)
- Only needed if you activate video formats (ugc-reaction, ugc-talking)
- Verify: `ffmpeg -version`

### 6. Demo Clip (required for video formats)
- Record a screen recording of your product in action (any length)
- Upload to Google Drive
- Add the Drive file ID to your app.json:
  ```json
  "demoClip": { "driveFileId": "YOUR_FILE_ID" }
  ```
- The AI-generated clip (4s or 8s) gets stitched before your demo

### 7. Platform Connections
- In the Dropspace dashboard, connect the social accounts you want to post to
- Go to Settings → Connections → Connect for each platform
- Supported: Twitter/X, Instagram, TikTok, LinkedIn, Facebook, Reddit

### 8. System Dependencies (for visual formats)
- The `canvas` npm package requires native libraries for image generation:
  - **macOS:** `brew install pkg-config cairo pango libpng jpeg giflib librsvg`
  - **Ubuntu/Debian:** `sudo apt install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev`
- If `npm install` fails on canvas, text-only formats (text-single, text-post) still work
- Video formats (ugc-reaction, ugc-talking) don't need canvas — they use fal.ai

### 9. OpenClaw (recommended)
- The pipeline is designed to run as an OpenClaw skill with cron scheduling
- Install: `npm install -g openclaw`
- Docs: [docs.openclaw.ai](https://docs.openclaw.ai)
- Alternative: run scripts manually or via your own cron system

## Environment Variables

```bash
export DROPSPACE_API_KEY="ds_live_..."      # required
export ANTHROPIC_API_KEY="sk-ant-..."       # required
export FAL_KEY="..."                        # required for visual platforms
```

## Quick Start

```bash
node setup.js --template markus-content-engine
# Follow the prompts to configure your app
```

The setup wizard will:
1. Ask for your API keys
2. Create your app directory at `~/markus/apps/{your-app}/`
3. Generate `app.json` with your product details and platform config
4. Create voice guidelines and content context files
5. Optionally set up cron jobs for automated posting

### Day 1

The pipeline runs overnight: self-improve (1 AM) generates posts, schedule-day (2 AM) schedules them. On your first day, nothing posts automatically — the queue is empty until the first self-improve run.

To get posts going immediately after setup:
```bash
source load-env.sh
# Generate posts
node engines/self-improve-engine.js --app yourapp --platform twitter --days 14
# Schedule them
node scripts/schedule-day.js --app yourapp
```

### Custom Data Directory

By default, all app data lives at `~/markus/apps/`. Set `APPS_DATA_ROOT` to use a different location:
```bash
export APPS_DATA_ROOT="/path/to/your/apps"
```
