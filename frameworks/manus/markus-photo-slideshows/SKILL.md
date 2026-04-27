# Event Photo Slideshows — Manus

Turn event photos into TikTok/Instagram slideshows via Dropspace. Runs in Manus cloud sandbox.

**Requires:** `DROPSPACE_API_KEY` (set in Manus Settings > Environment), `ffmpeg`. Installs from [github.com/joshchoi4881/markus](https://github.com/joshchoi4881/markus).

## Setup

```bash
git clone https://github.com/joshchoi4881/markus.git
cd markus && npm install

node scripts/init-app.js --app myapp --platforms tiktok,instagram
```

Set `DROPSPACE_API_KEY` via Manus Settings > Environment. Edit `apps/myapp/app.json` with your event details. Set up Google Workspace credentials for Drive access (see `templates/markus-photo-slideshows/SETUP.md`).

```bash
node scripts/test-pipeline.js --app myapp
```

## Run

```bash
node clipper/scripts/create-slideshows.js --app myapp
node scripts/schedule-day.js --app myapp
```

## Schedule with Manus

Set up a Scheduled Task (Manus Settings > Scheduled Tasks) — daily or weekly:
- `cd markus && node clipper/scripts/create-slideshows.js --app myapp && node scripts/schedule-day.js --app myapp`

## Manus Caveats

- **Google Drive access:** Configure GWS credentials as Manus secrets.
- **Sandbox reset:** Photo tracking state (which photos were used) is lost on reset. Pipeline will re-use photos after recovery.
