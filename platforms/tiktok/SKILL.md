---
name: tiktok
description: Automate TikTok marketing across multiple apps using Dropspace for publishing/analytics. Use when setting up TikTok content automation, creating slideshow posts, analyzing post performance, optimizing marketing funnels, or when user mentions TikTok growth, slideshows, or social media marketing for any app.
---

# TikTok Marketing

Automate TikTok slideshow marketing: generate → overlay → publish via Dropspace → track → iterate.

## Pipeline Architecture

All platforms share a common engine at `~/markus/`. No per-platform scripts — everything runs through shared engines with platform config from `platforms.js`.

**Data:** `~/markus/apps/{app}/tiktok/` (strategy.json, posts.json, failures.json, pending-batches.json, posts/)
**App config:** `~/markus/apps/{app}/app.json` (single source of truth for app identity, integrations, platform settings)

### Key Scripts (all in `~/markus/`)
```bash
# Create a post (auto-picks from queue)
node engines/create-visual-post-engine.js --app <APP> --platform tiktok --next --schedule "2026-03-04T12:00:00Z"

# Pre-generate images via OpenAI Batch API (50% cheaper)

# Self-improve (analytics + strategy optimization)
node engines/self-improve-engine.js --app <APP> --platform tiktok --days 14

# Validate setup

# Add posts to queue (pipe JSON to stdin)
echo '{"posts":[...],"notes":"..."}' | node scripts/add-posts.js --app <APP> --platform tiktok
```

## TikTok Details

- **Format:** `story-slideshow` (default) — 5 content slides + engine CTA (1024×1536 portrait).
- **3 posts/day** at 8AM, 1PM, 6PM ET
- **Image model:** gpt-image-1.5 (never gpt-image-1)
- **Privacy:** `SELF_ONLY` — posts land as drafts in your TikTok inbox. He adds trending sound, changes privacy to public.
- **Music:** `auto_add_music: true` as fallback. Manual trending sound = ~100x more views.

## The Larry Slide Formula (5 content + engine CTA)

| Slide | Purpose | Text Style |
|-------|---------|------------|
| 1 | **HOOK** — stop the scroll | Full hook text, relatable problem |
| 2 | **PROBLEM** — amplify pain | Build tension |
| 3 | **DISCOVERY** — turning point | "So I tried this..." |
| 4 | **TRANSFORMATION 1** — first result | "Wait... this actually works?" |
| 5 | **TRANSFORMATION 2** — escalate | "Okay I'm obsessed" |

*Note: Slide 6 (CTA) is engine-appended. The LLM generates 5 content slides only.*

## Text Overlays

Sizing:
- Short text (≤5 words): 7.5% of image width
- Medium (≤12 words): 6.5%
- Long (13+): 5.0%
- Outline: 15% of font size

Positioning:
- Centered at ~28% from top (safe zone)
- Top 10% hidden by TikTok status bar
- Bottom 20% hidden by TikTok UI
- Max width: 75% of image

Content:
- REACTIONS not labels: "Wait... this is nice??" not "Modern minimalist"
- 4-6 words per line
- 3-4 lines per slide ideal
- No emoji (canvas can't render them)
- Full hook on slide 1 — never split across slides

## Content Rules

### Tone
- **Most emotional of all platforms** — TikTok rewards vulnerability and relatability
- **Storytelling > information** — "i literally cried" beats "here are 5 tips"
- **All lowercase** — TikTok native voice
- **Emoji encouraged** — 😭 🫠 💀 are TikTok-native
- **No corporate voice** — instant scroll-past

### Caption Formula
```
[hook matching slide 1] 😭 [2-3 sentences of relatable struggle].
So I found [APP NAME] that [what it does in one sentence] —
you just [simple action] and it [result].
I tried [thing 1] and [thing 2] and honestly?? [emotional reaction].
[funny/relatable closer]
#hashtag1 #hashtag2 #hashtag3 #hashtag4 #fyp
```

Rules:
- Storytelling, not feature lists. Long captions get 3x more views.
- Mention app naturally — never "Download now!"
- Max 5 hashtags
- Conversational tone, like texting a friend

### Hook Formulas

**Tier 1: Person + Conflict → Result (consistently 50K+)**
- "[Person] said [doubt/insult] so I showed them [result]"
- "I showed my [person] what [app] can do and they couldn't believe it"

**Tier 2: Relatable Pain → Discovery**
- "I was spending [X hours] on [task] until I found this"
- "POV: you have [aspiration] but [constraint]"

**Tier 3: Curiosity / Challenge**
- "I tried to [challenge] using only AI"
- "Can AI actually [thing people doubt]?"

**What DOESN'T work:** Feature lists, self-focused complaints without conflict, fear/insecurity hooks.

## Post Blueprint Structure

When generating posts for the queue via `add-posts.js`, the blueprint structure depends on the format:

### Visual formats (story-slideshow)

**story-slideshow** uses `sceneAnchor` + `slideMoods` (locked architecture — see `formats.js` and `formats.js story-slideshow entry`):
```json
{
  "format": "story-slideshow",
  "text": "Hook text",
  "slideTexts": ["Slide 1 text", "Slide 2", "Slide 3", "Slide 4", "Slide 5"],
  "sceneAnchor": "Detailed scene (150-300 words): room, furniture, person, camera. Shared across all slides.",
  "slideMoods": ["mood delta 1 (30-60 words)", "mood 2", "mood 3", "mood 4", "mood 5"],
  "caption": "Storytelling caption with #hashtags"
}
```

### Video formats (ugc-reaction)
```json
{
  "text": "Hook text",
  "videoPrompt": "6-second video description...",
  "caption": "Caption"
}
```

Engine auto-appends CTA slide for formats with `ctaSlide: true`.

## Self-Improvement Thresholds

- **Tier 1 (double down):** 50,000+ avg views
- **Tier 2 (keep):** 10,000+ avg views
- **Drop threshold:** 5,000 avg views
- **Individual hook drop:** <1,000 views
- **Winner for variations:** 10,000+ views

Note: The pipeline now uses **engagement rate** as the primary optimization signal. Raw view thresholds are secondary guidance.

## Diagnostic Framework

| Views | Conversions | Diagnosis | Action |
|-------|-------------|-----------|--------|
| 🟢 High | 🟢 High | SCALE | 3 variations of winning hook |
| 🟢 High | 🔴 Low | FIX CTA | Rotate CTAs, check landing page |
| 🔴 Low | 🟢 High | FIX HOOKS | Test different hooks, keep CTA |
| 🔴 Low | 🔴 Low | FULL RESET | New format, new audience angle |

## Attribution

First-touch attribution (if configured) captures referral source:
- UTM: `<configured in app.json utmTemplate>
- TikTok caveat: single "link in bio" — per-post attribution uses signup timing vs post timing (72h window)

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Landscape images (1536x1024) | Portrait always (1024x1536) |
| Font too small (5%) | 6.5% of width minimum |
| Text at top/bottom of image | Position at 28% from top |
| Different scenes per slide | Lock architecture, only change style |
| Labels instead of reactions | "Wait this is nice??" not "Modern style" |
| gpt-image-1 instead of 1.5 | Always gpt-image-1.5 |
| Generic image prompts | Be obsessively specific |
