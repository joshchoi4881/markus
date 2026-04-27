# DJ Set Clipper — Manus

Extract short clips from DJ set recordings and schedule to TikTok/Instagram via Dropspace. Runs in Manus cloud sandbox.

**Requires:** `DROPSPACE_API_KEY` (set in Manus Settings > Environment), `ffmpeg`. Installs from [github.com/joshchoi4881/markus](https://github.com/joshchoi4881/markus).

## Setup

```bash
git clone https://github.com/joshchoi4881/markus.git
cd markus && npm install
apt-get install -y ffmpeg

node scripts/init-app.js --app myapp --platforms tiktok,instagram
```

Set `DROPSPACE_API_KEY` via Manus Settings > Environment. Edit `apps/myapp/app.json` with your event details. Set up Google Workspace credentials for Drive access (see `templates/markus-dj-clipper/SETUP.md`).

```bash
node scripts/test-pipeline.js --app myapp
```

## Run

```bash
node clipper/scripts/clip-engine.js --app myapp --source ~/videos/dj-set.mp4
node scripts/schedule-day.js --app myapp
```

## Manus Caveats

- **Sandbox TTL (30 min):** Long videos may timeout during ffmpeg processing. Use shorter sets or pre-cut segments.
- **File upload:** Upload source video to the Manus sandbox before running.
- **Sandbox reset:** Extracted clips are lost on reset. Schedule posting promptly after extraction.
