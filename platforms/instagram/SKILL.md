---
name: instagram
description: Automate Instagram carousel marketing for your app using AI-generated images, text overlays, and Dropspace for publishing/analytics. Use when creating Instagram posts, analyzing carousel performance, or managing Instagram content strategy.
---

# Instagram Carousel Marketing

Automate Instagram carousel marketing: generate images → overlay text → publish via Dropspace → track → iterate.

## Pipeline Architecture

All platforms share a common engine at `~/dropspace/private/`. No per-platform scripts — everything runs through shared engines with platform config from `platforms.js`.

**Data:** `~/dropspace/apps/{app}/instagram/` (strategy.json, posts.json, failures.json, pending-batches.json, posts/)
**App config:** `~/dropspace/apps/{app}/app.json`

### Key Scripts (all in `~/dropspace/private/`)
```bash
# Create a carousel (auto-picks from queue)
node engines/create-visual-post-engine.js --app <APP> --platform instagram --next --schedule "2026-03-04T13:00:00Z"

# Pre-generate images via OpenAI Batch API

# Self-improve (analytics + strategy optimization)
node engines/self-improve-engine.js --app <APP> --platform instagram --days 14

# Validate setup

# Add posts to queue
echo '{"posts":[...],"notes":"..."}' | node scripts/add-posts.js --app <APP> --platform instagram
```

## Instagram Details

- **Format:** Carousels — 5 content slides + engine CTA (1024×1536 portrait).
- **1 post/day** at 8:00 AM ET
- **Hashtags:** Up to 20 per post (core + niche + discovery rotation)
- **Min 2 images** per carousel (Instagram requirement)
- **CTA pool:** "DM me 'launch' for the link", "link in bio", "tap the link in bio"
- **UTM:** `<configured in app.json utmTemplate>

## The Slide Formula (5 content + engine CTA)

| Slide | Purpose | Text Style |
|-------|---------|------------|
| 1 | **HOOK** — stop the scroll | Full hook text, relatable problem |
| 2 | **PROBLEM** — amplify pain | Build tension |
| 3 | **DISCOVERY** — turning point | "So I tried this..." |
| 4 | **TRANSFORMATION 1** — first result | "Wait... this actually works?" |
| 5 | **TRANSFORMATION 2** — escalate | "Okay I'm obsessed" |

*Note: Slide 6 (CTA) is engine-appended. The LLM generates 5 content slides only.*

## Text Overlays

Same rules as TikTok:
- Centered at ~28-30% from top (safe zone)
- REACTIONS not labels
- 4-6 words per line, 3-4 lines per slide
- No emoji in overlays (canvas can't render)
- Full hook on slide 1

## Content Rules

### Tone
- **Conversational** — like texting a friend about something cool
- **Emoji encouraged** — Instagram is emoji-native, 3-5 per caption
- **Storytelling > feature lists** — long captions get more engagement
- **No corporate voice** — "I found this" not "We're excited to announce"
- **Relatable struggles** — the audience is founders/creators

### Caption Formula
```
[hook matching slide 1] 😭 [2-3 sentences of relatable struggle].
So I found [APP NAME] that [what it does in one sentence] —
you just [simple action] and it [result].
I tried [thing 1] and [thing 2] and honestly?? [emotional reaction].
[funny/relatable closer]

DM me "launch" for the link 🔗

#hashtag1 #hashtag2 ... #hashtag20
```

Rules:
- Storytelling, not feature lists
- Up to 20 hashtags (mix core + niche + discovery)
- "DM me" CTA is Instagram-native and drives engagement
- Mention app naturally


## Post Blueprint Structure

**story-slideshow** uses `sceneAnchor` + `slideMoods` (locked architecture — see `formats.js`):
```json
{
  "format": "story-slideshow",
  "text": "Hook text",
  "slideTexts": ["Slide 1", "Slide 2", "Slide 3", "Slide 4", "Slide 5"],
  "sceneAnchor": "Detailed scene (150-300 words). Shared across all slides.",
  "slideMoods": ["mood 1", "mood 2", "mood 3", "mood 4", "mood 5"],
  "caption": "Caption"
}
```

Other visual formats use `slidePrompts`. Video formats use `videoPrompt`. See `formats.js` for full format specs.

## Self-Improvement Thresholds

Instagram has lower organic reach than TikTok:
- **Tier 1 (double down):** 10,000+ avg views
- **Tier 2 (keep):** 3,000+ avg views
- **Drop threshold:** 1,000 avg views
- **Individual hook drop:** <300 views
- **Winner for variations:** 3,000+ views

### Metrics Tracked
views, likes, comments, shares, saved, engagement rate

Note: The pipeline now uses **engagement rate** as the primary optimization signal. Raw view thresholds are secondary guidance.
