---
name: fal
description: Generate images and videos via Fal.ai API. Use when generating AI images (FLUX, nano-banana-2), AI videos (Veo 3.1), or any Fal.ai model. Supports queue-based async generation with polling, reference image editing, and file download. Also use when the content pipeline needs direct image/video generation bypassing Dropspace rate limits.
---

# Fal.ai Generation

Generate images and videos directly via Fal.ai Queue API. Zero dependencies (Node.js only).

## Auth

```bash
export FAL_KEY="your-fal-api-key"
export FAL_KEY="your-fal-api-key"
```

## Script

All generation via `scripts/fal-generate.js` (relative to this skill directory).

### Generate Image

```bash
node ~/.openclaw/skills/fal/scripts/fal-generate.js image \
  --prompt "founder working at desk, cinematic lighting" \
  --aspect 9:16 \
  --out /tmp/slide.png
```

Options:
- `--prompt` (required): Image description
- `--aspect`: Ratio (default `9:16`). Options: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `5:4`, `4:5`
- `--model`: Fal model ID (default `fal-ai/nano-banana-2`). Other: `fal-ai/flux/dev`, `fal-ai/flux/schnell`, `fal-ai/flux-pro/v1.1-ultra`
- `--reference-image`: URL of reference image (auto-uses `/edit` endpoint for style guidance)
- `--out`: Download result to path
- `--no-wait`: Return request_id immediately without polling
- `--timeout`: Poll timeout in ms (default 120000)

### Generate Video

```bash
node ~/.openclaw/skills/fal/scripts/fal-generate.js video \
  --prompt "young founder picks up phone, looks surprised at screen" \
  --aspect 9:16 \
  --duration 8 \
  --out /tmp/clip.mp4
```

Options:
- `--prompt` (required): Video description
- `--aspect`: `9:16` (default) or `16:9`
- `--duration`: `4`, `6`, or `8` seconds (default 8)
- `--model`: Fal model ID (default `fal-ai/veo3.1`)
- `--out`: Download result to path
- `--no-wait`: Return request_id immediately
- `--timeout`: Poll timeout in ms (default 300000)

**Note:** Duration must be integer (not string). Sora 2 supports 4, 8, or 12 seconds only.

### Check Status / Get Result

```bash
# Check if a job is done
node ~/.openclaw/skills/fal/scripts/fal-generate.js status \
  --model fal-ai/nano-banana-2 --request-id <id>

# Fetch completed result (+ optional download)
node ~/.openclaw/skills/fal/scripts/fal-generate.js result \
  --model fal-ai/nano-banana-2 --request-id <id> --out /tmp/img.png
```

## Output Format

JSON to stdout. Images:
```json
{"request_id":"...","model":"fal-ai/nano-banana-2","images":[{"url":"https://...","width":768,"height":1344}],"seed":123}
```

Videos:
```json
{"request_id":"...","model":"fal-ai/veo3.1","video":{"url":"https://...","duration":8}}
```

## Models & Pricing

| Model | Type | Cost | Notes |
|-------|------|------|-------|
| `fal-ai/nano-banana-2` | Image | ~$0.08 | Default. Same model Dropspace uses. |
| `fal-ai/nano-banana-2/edit` | Image | ~$0.08 | Reference image guidance (auto-selected with `--reference-image`) |
| `fal-ai/flux/schnell` | Image | ~$0.003 | Fast, lower quality |
| `fal-ai/flux/dev` | Image | ~$0.025 | Good balance |
| `fal-ai/flux-pro/v1.1-ultra` | Image | ~$0.05 | Up to 2K, best realism |
| `fal-ai/veo3.1` | Video | ~$0.15/sec | Veo 3.1. 4-8s clips with audio. |

## Pipeline Integration

To bypass Dropspace's 5/min rate limit, generate images directly then attach to launches:

1. Generate image: `fal-generate.js image --prompt "..." --out /tmp/slide1.png`
2. Upload to Dropspace launch as pre-made media (no `/media/generate` call needed)

This avoids `checkMediaGenerateLimit` entirely since you're uploading finished images, not requesting generation through the Dropspace API.
