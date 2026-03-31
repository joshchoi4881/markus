---
name: linkedin
description: Automate LinkedIn marketing for your app with text-only posts. Weekdays only. Post types include hot takes, frameworks, build-in-public updates, before/after transformations, and lessons learned. Use when creating LinkedIn posts, analyzing engagement, or managing LinkedIn content strategy.
---

# LinkedIn Marketing

Automate LinkedIn text-only marketing. Highest-conversion platform for B2B SaaS — the audience (founders, product managers, startup operators) is literally your target customer.

## Pipeline Architecture

All platforms share a common engine at `~/dropspace/private/`. No per-platform scripts — everything runs through shared engines with platform config from `platforms.js`.

**Data:** `~/dropspace/apps/{app}/linkedin/` (strategy.json, posts.json, failures.json)
**App config:** `~/dropspace/apps/{app}/app.json`

### Key Scripts (all in `~/dropspace/private/`)
```bash
# Create a post (auto-picks from queue)
node engines/create-text-post-engine.js --app <APP> --platform linkedin --next --schedule "2026-03-04T13:30:00Z"

# Self-improve (analytics + strategy optimization)
node engines/self-improve-engine.js --app <APP> --platform linkedin --days 14

# Validate setup

# Add posts to queue
echo '{"posts":[...],"notes":"..."}' | node scripts/add-posts.js --app <APP> --platform linkedin
```

## LinkedIn Details

- **Text-only** — no images, no slideshows
- **1 post/day, weekdays only** (Mon-Fri) at 8:30 AM ET
- **Link at end of post** — The API doesn't support commenting, so link goes in body
- **Max 3 hashtags**, max 3 emoji
- **Line breaks after every 1-2 sentences** (LinkedIn mobile formatting)
- **First 2-3 lines are the hook** — that's all that shows before "see more"
- **UTM:** `<configured in app.json utmTemplate>

## Post Types

| Type | Frequency | Length | Description |
|------|-----------|--------|-------------|
| hot-take | 25% | 100-250 words | Contrarian, confident, opens debate |
| framework-list | 25% | 200-400 words | Numbered/bulleted, actionable, save-worthy |
| build-in-public | 20% | 200-400 words | Real numbers, founder voice |
| before-after | 15% | 100-200 words | Concrete transformation, specific numbers |
| lesson-learned | 15% | 150-300 words | Lead with mistake, actionable takeaway |

## Content Rules

### Tone
Professional but personal. Founder talking to other founders — not a brand, not a bro-marketer. Confident without being arrogant.

### Format
- **Line break after every 1-2 sentences** — LinkedIn mobile demands whitespace
- **Hook line first** — standalone sentence that stops the scroll
- **150-300 words**
- **Use numbered lists or → arrows for structure**
- **End with a question or CTA** — drives comments (LinkedIn algorithm rewards comments)
- **Include link at the end**
- **2-3 hashtags max** at the very end: `#buildinpublic #startup #saas`
- **No emoji walls** — one or two max

### Example postBody
```
I compared two approaches to product launches. The gap was shocking.

Approach A (manual):
→ Rewrite announcement for each platform
→ Adjust tone, format, and length 9 times
→ Time spent: 3+ hours

Approach B (automated):
→ Describe product once
→ AI generates platform-native content
→ Time spent: under a minute

The quality gap surprised me most. The automated posts matched each platform's tone better than what I was writing manually.

Distribution shouldn't take longer than building.

<your-app-url>

#buildinpublic #startup #saas
```

## Post Blueprint Structure

```json
{
  "format": "text-thread",
  "text": "Hook text (first line — what shows before 'see more')",
  "postBody": "Full post body with line breaks between paragraphs",
  "source": "x-research"
}
```

## Self-Improvement Thresholds

- **Tier 1 (double down):** 5,000+ avg impressions
- **Tier 2 (keep):** 1,000+ avg impressions
- **Drop threshold:** <500 avg impressions (5+ posts)
- **Winner for variations:** 1,000+ impressions

### Metrics Tracked
impressions (total + unique), clicks, engagement (likes + comments + shares), engagement rate
