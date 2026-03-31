---
name: clipper
description: "Content clipping engine — process videos and images from Google Drive into short-form content. Video clips via audio peak detection + FFmpeg. Image slideshows via Drive folder selection + canvas overlays. Use when user asks to clip videos, create slideshows from photos, process footage, or create short-form content from existing media."
---

# Clipper — Content Clipping Engine

Standalone skill for processing source media (videos + images) from Google Drive into short-form content. Works with the shared Dropspace pipeline for distribution.

## Two Modes

### 1. Video Clips (TikTok/Reels)
```
Google Drive video → analyze.js → cut.js → queue.js → add-posts.js → schedule-day (video engine)
```

### 2. Image Slideshows (Instagram/TikTok/Facebook)
```
Google Drive images → slideshow.js → slideshow-queue.js → add-posts.js → schedule-day (visual engine)
```

## Scripts

All scripts at `~/.openclaw/skills/clipper/scripts/`.

### Video Scripts

#### clip-engine.js (Video Orchestrator)
```bash
node clip-engine.js --app <APP> --source <drive_file_id> \
  --event "Summer Sessions" --artist "DJ Phoenix" \
  [--max-clips 5] [--duration 30] [--dry-run]
```

#### source.js — Google Drive Download
```bash
node source.js --file-id <drive_id> --output ~/.cache/clipper/source.mp4
```

#### analyze.js — Audio Peak Detection
```bash
node analyze.js --input source.mp4 --output analysis.json [--top 5] [--min-gap 60]
```
Finds energy peaks via audio RMS analysis. Outputs ranked clip candidates.

#### cut.js — FFmpeg Clip Extraction
```bash
node cut.js --input source.mp4 --analysis analysis.json --clip 1 \
  --duration 30 --crop center --output clip.mp4
```
Crops to 9:16 vertical, encodes H.264 CRF 23. Static FFmpeg lacks drawtext — overlays disabled.

#### queue.js — Queue Video Post
```bash
node queue.js --app <APP> --platform tiktok \
  --video clip.mp4 --text "Hook text 🔥" --caption "Caption with #hashtags"
```

### Image Slideshow Scripts

#### slideshow.js — Download Images from Drive
```bash
# From a specific folder
node slideshow.js --folder <drive_folder_id> --output /tmp/slides [--count 6] [--shuffle]

# From app.json config
node slideshow.js --app <APP> --platform instagram --output /tmp/slides

# With offset (for batch processing — skip first N images)
node slideshow.js --folder <id> --output /tmp/slides --count 6 --offset 12
```
Scans folder + subfolders for images (jpg/png/webp). Downloads selected images.
Outputs JSON array of paths to stdout.

#### slideshow-queue.js — Queue Slideshow Post
```bash
node slideshow-queue.js --app <APP> --platform instagram \
  --hook "Summer Sessions Highlights 🎤" \
  --caption "Live music moments from NYC #<APP>" \
  --texts "Slide 1 text,Slide 2 text,Slide 3 text" \
  --images /tmp/slides/slide1.jpg,/tmp/slides/slide2.jpg,...

# Or pipe from slideshow.js:
node slideshow.js --folder <id> --output /tmp/slides | \
  node slideshow-queue.js --app <APP> --platform instagram \
    --hook "..." --caption "..."
```
Creates a queue entry with `imagePaths` + `imageSource: "drive"`.
The visual engine detects `imagePaths`, skips AI generation, and uses the real images.

## app.json Config

### Video content source
```json
{
  "contentSources": {
    "clipper": {
      "driveFolder": "...",
      "clipDuration": 30,
      "cropMode": "center"
    }
  },
  "platforms": {
    "tiktok": {
      "contentSource": "clipper"
    }
  }
}
```

### Image slideshow content source
```json
{
  "contentSources": {
    "drive-slideshow": {
      "driveFolder": "...",
      "slidesPerPost": 6
    }
  },
  "platforms": {
    "instagram": {
      "contentSource": "drive-slideshow"
    }
  }
}
```

## How the Visual Engine Handles Pre-Sourced Images

When a queue entry has `imagePaths` (array of file paths):
1. Visual engine copies images → resizes/crops to 1024×1536 (9:16) via canvas
2. If `slideTexts` has content → applies text overlays (same styles as AI posts)
3. If `slideTexts` are empty strings → uses raw images, no overlay
4. Creates Dropspace launch with the images (same as AI-generated flow)

This means **text overlays are optional** — you can post raw photos or add text.

### Photo Slideshow Builder

#### create-slideshows.js — Two-Step Pipeline (Prepare → Agent Text → Build)

**Step 1: Prepare** — group photos into slideshow assignments
```bash
node create-slideshows.js --app <APP> --event my-event --prepare
```
Groups Drive photos into slideshows (face-first for slide 1), saves to `postQueue`
in strategy.json with `status: "needs-text"`. No LLM calls, no uploads.

**Step 2: Agent generates text** — the agent reads the queue entries, generates
`slideTexts` (array of overlay texts) and `caption` (TikTok caption) for each entry,
then updates strategy.json. This follows the same pattern as the ai-generated pipeline:
agent owns all text generation using FORMAT.md voice + ANTI-PATTERNS.md.

**Step 3: Build** — create launches from text-ready queue entries
```bash
node create-slideshows.js --app <APP> --event my-event
```
Reads queue entries with slideTexts + caption, downloads photos, applies overlays,
creates Dropspace launches. Purely mechanical — no LLM calls.

Reads from app.json: `apiKeyEnv`, `platforms.{platform}.connectionId`.

**Slideshow standards (enforced in code + documented in FORMAT.md):**
- **Overlay style:** story-slideshow best practice — white text + black stroke, NO bg box. Preset: `photo-slideshow`.
- **Face-aware:** photos with faces get bottom-safe text (72% from top), others get upper-third (30%).
- **Slide 1 = face photo.** Every slideshow leads with a human face from `photo-metadata.json`.
- **Leftovers:** extra photos round-robin across last few slideshows as extra slides.
- **Title format:** lowercase `slideshow N`, numbering continues from `slideshowCount` in tracker.
- **Text generation:** ALWAYS by the agent (never inline LLM). Same pattern as ai-generated pipeline.
- **Face metadata:** `photo-metadata.json` in app data dir. `hasFace` boolean per photo ID.

### DJ Set Clipping Process

**Do NOT use Shazam (identify-songs.js) for song identification.** Shazam is unreliable in mix contexts.

#### Overview
Two-phase clipping:
1. **Transition clips** — one clip per track boundary, centered on the crossover point. These are the primary clips.
2. **Peak clips** — energy/drop moments from analyze.js. Additional clips AFTER all transitions, skipping any that overlap significantly with transition clips.

#### Step 1: Prepare tracklist JSON
Provide the authoritative tracklist. Create a JSON file:
```json
[
  { "track": 1, "song": "song name", "artist": "artist name" },
  { "track": 2, "song": "Miracle", "artist": "Madeon" }
]
```

#### Step 2: Timestamp the tracklist
```bash
node ~/.openclaw/skills/clipper/scripts/timestamp-tracklist.js \
  --input source.mp4 --tracklist tracklist.json \
  --interval 30 --sample-length 10 \
  --output tracklist-timestamps.json
```
Samples audio every 30 seconds, transcribes with Whisper, matches lyrics to known songs. Outputs the tracklist with `startSec` added to each track.

**Review the output.** Timestamps are approximate — verify against the event CONTEXT.md and adjust manually if needed.

#### Step 3: Clip transitions + peaks
```bash
node ~/.openclaw/skills/clipper/scripts/clip-transitions.js \
  --input source.mp4 --tracklist tracklist-timestamps.json \
  --output-dir ~/dropspace/apps/<APP>/clips/event-name \
  --duration 30 --extra-peaks 5 --min-gap 45
```

This produces:
- **Clips 01-N:** One per transition (N = tracks - 1), centered on the boundary
- **Clips N+1 onwards:** Energy peaks that don't overlap with transitions (≥40% overlap = skipped)
- **clips-manifest.json:** Full metadata — songs, timestamps, captions for each clip

#### Step 4: Review manifest + write captions
The manifest includes auto-generated captions in `{song a} by {artist} into {song b} by {artist}` format. Review and adjust to match the event's caption pattern (see event CONTEXT.md).

#### Key Rules

##### Three-Layer Sync (CRITICAL)
Clips exist in three places that MUST stay in sync: **local files**, **Google Drive**, and **Dropspace launches**. The manifest (`clips-manifest.json`) is the single source of truth linking all three via `driveFileId` and `launchId` per clip.

**On ANY clip modification** (re-cut, shift timing, rename, etc.):
1. Re-cut the local `.mp4` file (**always with 9:16 crop** — see Video Format below)
2. Update the Drive file: `gws drive files update --params '{"fileId":"<driveFileId>"}' --upload <local_path>`
3. Update the Dropspace launch media via **PATCH** (see [Dropspace API docs](https://www.dropspace.dev/docs)):
   ```
   PATCH /launches/{launchId}
   {
     "media": [{ "source": "url", "url": "https://drive.google.com/uc?export=download&id=<driveFileId>" }],
     "media_attach_platforms": ["tiktok", "instagram"],
     "media_mode": "video"
   }
   ```
4. Update `clips-manifest.json` if any IDs or timestamps changed
5. Update the event's `CONTEXT.md` (e.g. `~/dropspace/apps/<APP>/config/{event}/CONTEXT.md`) — clip table must reflect current timestamps

**Dropspace PATCH supports** (per [docs](https://www.dropspace.dev/docs)): `media` (replace assets via URL or base64), `media_assets`, `media_attach_platforms`, `media_mode`, `platform_contents`, `scheduled_date`, and more. `media` and `media_assets` are mutually exclusive. Use PATCH to update in place — **no need to delete + recreate** just to swap media.

**Delete + recreate only when:** you need to change the launch title or fundamentally restructure the launch.

**If you do delete + recreate:** always clean up `cancelled` status launches afterward (`GET /launches?status=cancelled`). Deleting a scheduled launch moves it to cancelled, not gone.

**Never** just re-cut locally without syncing Drive + launch. Dropspace fetches video at launch creation time — updating Drive alone doesn't fix existing launches.

**API reference:** https://www.dropspace.dev/docs | LLM-friendly: https://www.dropspace.dev/llms.txt | OpenAPI spec: https://www.dropspace.dev/openapi.json

**Naming convention (applies to ALL events — subtle radio, nook, any future folder):**

The name is **`{event} {number}`** where `{event}` = the clips subfolder name (lowercase, spaces) and `{number}` = zero-padded clip number. This MUST be identical across all three layers:

| Layer | Format | Example (event=`nook`, clip 03) |
|-------|--------|---------------------------------|
| Local file | `{event} {NN}.mp4` | `nook 03.mp4` |
| Google Drive file | `{event} {NN}.mp4` | `nook 03.mp4` |
| Dropspace launch title | `{event} {NN}` | `nook 03` |

- No prefixes ("clip-", "clip_"), no hyphens in the event name. Just `{event} {number}`.
- Numbering is continuous across batches. If clips 01-03 already posted, new clips start at 04.
- The clips folder path determines the event name: `~/dropspace/apps/<APP>/clips/{event}/` → name = `{event}`.

**Renaming local files:** Never do sequential `mv` renames (e.g. clip01→04 overwrites existing clip04). Use a temp dir or re-cut from source with correct names.

**Manifest fields per clip:**
- `num` — clip number (matches filename, Drive name, launch title)
- `file` — local filename (e.g. `nook 03.mp4`)
- `driveFileId` — Google Drive file ID
- `launchId` — Dropspace launch ID
- `startSec`, `endSec` — source video timestamps
- `caption` — text content for the post

##### Video Format (CRITICAL)
All clips for TikTok/Instagram MUST be **1080×1920 (9:16 portrait)**. The `clip-transitions.js` script handles this automatically, but manual `ffmpeg` commands must include the crop+scale filter:

```bash
# For 1920x1080 source → 9:16 center crop:
~/bin/ffmpeg -y -ss <START> -i <SOURCE> -t <DURATION> \
  -vf "crop=608:1080:656:0,scale=1080:1920:flags=lanczos" \
  -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k \
  -movflags +faststart output.mp4
```

**Crop math for 1920×1080 source:** target ratio = 9/16. cropW = round(1080 × 9/16) = 608, cropH = 1080, cropX = round((1920-608)/2) = 656, cropY = 0. Then scale up to 1080×1920.

**Never omit the crop filter.** Raw landscape clips will look wrong on TikTok/Instagram.

##### Content Rules
- **The user's tracklist is authoritative.** Never override it with Shazam or other detection.
- **Transitions first, peaks second.** Every track boundary gets a clip. Peaks are bonus content.
- **No significant overlaps.** Peak clips that overlap ≥40% with any existing clip are skipped.
- **Sequential constraint.** Clips move forward through the set. A clip can't reference a song before the previous clip's song.
- **Whisper for timestamping, not identification.** Use it to match known lyrics to timestamps, not to discover unknown tracks.
- **Timestamps need manual review for instrumental tracks.** The algorithm auto-refines via Whisper lyrics + scoped energy analysis, but instrumental transitions (no matching lyrics, energy peaks in wrong place) can't be reliably auto-detected. Flag these for the user to verify.
- **Never modify completed/posted launches.** Treat posted captions as ground truth. Use them to validate timestamps, not the other way around.

## Google Drive Folder Structure (STANDARD)

All content follows this structure. **Never upload clips to Drive root.**

```
<APP>/                              ← source footage root (shared drive)
  {event}/                         ← event source folder (e.g. "nook", "subtle radio")
    source videos (.mov/.mp4)
    audio masters (.wav)
    clips/                         ← CLIPS GO HERE (subfolder inside source)
      {event} 01.mp4
      {event} 02.mp4
      ...
```

**Key rules:**
- Clips always go in `/<APP>/{event}/clips/` — inside the event's source folder
- `clip-engine.js` auto-creates/finds this folder. Manual uploads MUST follow the same pattern.
- The `clipsFolder` ID is stored in `app.json` at `contentSources.clipper.events.{event}.clipsFolder`
- When uploading manually via GWS, always use the `clipsFolder` ID from app.json as the parent
- The separate `/<APP> clips/` folder tree exists but is NOT the standard destination

**Manual upload example:**
```bash
# Get the clips folder ID from app.json
CLIPS_FOLDER=$(node -e "const a=require('$HOME/apps/<APP>/app.json');console.log(a.contentSources.clipper.events['<event-name>'].clipsFolder)")

# Upload with correct parent
gws drive files create --params '{"name":"nook 01.mp4","parents":["'$CLIPS_FOLDER'"],"supportsAllDrives":true}' --upload ~/dropspace/apps/<APP>/clips/nook/nook\ 01.mp4
```

## Dependencies

- `ffmpeg` / `ffprobe` — `~/bin/` (video only)
- `gws` CLI — Google Drive access
- `node-canvas` — `~/dropspace/node_modules/canvas` (image resize + overlays)
- 1Password — credentials for Drive + Dropspace

## Data Paths

- `~/dropspace/apps/{app}/sources/inventory.json` — Drive file index
- `~/dropspace/apps/{app}/{platform}/strategy.json` — post queue
- `~/.cache/clipper/` — temp working dir (source downloads, cleaned after)
