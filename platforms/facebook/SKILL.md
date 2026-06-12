---
name: facebook
description: Automate Facebook marketing for your app with visual carousel posts. Use when creating Facebook posts, analyzing engagement, or managing Facebook content strategy.
---

# Facebook Marketing

Automate Facebook carousel marketing via Dropspace. Visual platform using the same 6-slide pipeline as TikTok and Instagram.

## Pipeline Architecture

All platforms share a common engine at `~/markus/`. No per-platform scripts — everything runs through shared engines with platform config from `platforms.js`.

**Data:** `~/markus/apps/{app}/facebook/` (strategy.json, posts.json, failures.json, pending-batches.json, posts/)
**App config:** `~/markus/apps/{app}/app.json`

### Key Scripts (all in `~/markus/`)
```bash
# Create a carousel (auto-picks from queue)
node engines/create-visual-post-engine.js --app <APP> --platform facebook --next --schedule "2026-03-04T14:00:00Z"

# Pre-generate images via OpenAI Batch API

# Self-improve (analytics + strategy optimization)
node engines/self-improve-engine.js --app <APP> --platform facebook --days 14

# Validate setup

# Add posts to queue
echo '{"posts":[...],"notes":"..."}' | node scripts/add-posts.js --app <APP> --platform facebook
```

## Facebook Details

- **Format:** Visual carousel — 5 content slides + engine CTA (1024×1536 portrait).
- **1 post/day** at 9:00 AM ET
- **Direct links** in posts (no "link in bio" limitation)
- **Minimal hashtags:** 0-5 max
- **Metrics:** impressions, reactions, comments, shares, linkClicks
- **UTM:** `<configured in app.json utmTemplate>

## The Slide Formula (5 content + engine CTA)

| Slide | Purpose | Text Style |
|-------|---------|------------|
| 1 | **HOOK** — stop the scroll | Bold claim or relatable pain point |
| 2 | **PROBLEM** — deepen the pain | "You've probably tried..." |
| 3 | **AGITATE** — show consequences | "Meanwhile you're still..." |
| 4 | **SOLUTION** — reveal the tool | Introduce the product |
| 5 | **PROOF** — show results | Screenshots, specifics |

*Note: Slide 6 (CTA) is engine-appended. The LLM generates 5 content slides only.*

## Content Rules

### Tone
- Conversational storytelling — like telling a friend about something that happened
- **1-2 emoji max** — only if they add meaning
- **Line breaks between every paragraph** — Facebook mobile is narrow
- **No marketing-speak** — gets scrolled past
- **First person always** — "i found", "i built"
- **No hashtags in post body** — feels corporate on Facebook

### Caption Formula
```
[hook matching slide 1]

[2-3 sentences of relatable struggle with line breaks]

So I found [APP NAME] that [what it does] —
you just [simple action] and it [result].

[funny/relatable closer]

Try it: <your-app-url>
```

## Post Blueprint Structure

```json
{
  "format": "story-slideshow",
  "text": "Hook text (under 100 chars)",
  "slideTexts": ["Slide 1 text", "...", "...", "...", "Slide 5"],
  "slidePrompts": ["Full image prompt 1", "...", "...", "...", "Full image prompt 5"],
  "caption": "Full storytelling caption",
  "source": "x-research"
}
```

## Self-Improvement Thresholds

- **Tier 1 (double down):** 5,000+ avg impressions
- **Tier 2 (keep):** 1,000+ avg impressions
- **Drop threshold:** 500 avg impressions
- **Individual drop:** 100 impressions
- **Winner for variations:** 1,000+ impressions

### Metrics Tracked
impressions, reactions, comments, shares, linkClicks

Note: The pipeline now uses **engagement rate** as the primary optimization signal. Raw view thresholds are secondary guidance.
