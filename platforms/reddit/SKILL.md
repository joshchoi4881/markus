---
name: reddit
description: Automate Reddit marketing with text-only posts to your subreddit. Text-only posts with multiple post types (build journals, lessons, data transparency, tips, community questions). Use when creating Reddit posts, analyzing engagement, or managing Reddit content strategy.
---

# Reddit Marketing

Automate Reddit marketing with text-only posts to your configured subreddit. Reddit is fundamentally different — authenticity and value-first content are critical.

## Pipeline Architecture

All platforms share a common engine at `~/markus/`. No per-platform scripts — everything runs through shared engines with platform config from `platforms.js`.

**Data:** `~/markus/apps/{app}/reddit/` (strategy.json, posts.json, failures.json)
**App config:** `~/markus/apps/{app}/app.json`

### Key Scripts (all in `~/markus/`)
```bash
# Create a post (auto-picks from queue)
node engines/create-text-post-engine.js --app <APP> --platform reddit --next --schedule "2026-03-04T15:00:00Z"

# Self-improve (analytics + strategy optimization)
node engines/self-improve-engine.js --app <APP> --platform reddit --days 14

# Validate setup

# Add posts to queue
echo '{"posts":[...],"notes":"..."}' | node scripts/add-posts.js --app <APP> --platform reddit
```

## Reddit Details

- **Text-only** — no images, no slideshows
- **1 post/day** at 10:00 AM ET
- **Posts to your configured subreddit** (set in app.json)
- **No hashtags, no emoji, no marketing-speak**
- **Direct links** allowed in post body
- **UTM:** `<configured in app.json utmTemplate>

## Reddit Engagement Model

Reddit uses **score** (net upvotes) and **comments** as primary metrics, NOT views/impressions.

**Engagement formula:** `score + (comments × 3)`

Comments are weighted 3× because they signal deeper engagement and higher conversion potential.

## Post Types

| Type | Frequency | Length | Description |
|------|-----------|--------|-------------|
| build-journal | 25% | 200-500 words | Genuine build-in-public update |
| lesson-learned | 20% | 200-400 words | Lead with insight, your product as context |
| data-transparency | 15% | 300-600 words | Real metrics, radical honesty |
| feature-announcement | 15% | 100-300 words | What shipped and why |
| tip-value | 15% | 200-400 words | Pure value, product mention only at end |
| community-ask | 10% | 50-200 words | Genuine question to community |

## Content Rules

### Tone
- **All lowercase** (like the user writes)
- **No hashtags** — Reddit hates them
- **No emoji** — reads as corporate/fake
- **No marketing-speak** — will get downvoted instantly
- **Conversational, stream-of-consciousness**
- **Genuine** — Reddit instantly detects and punishes fake tone
- **Write like a founder talking to other founders**

### Format
- **Title = hook** — max 300 chars, genuine question or observation (not clickbait)
- **Body = 150-500 words** — substantial enough to be worth reading
- **Tell a story** — personal experience > abstract advice
- **Paragraph breaks every 2-3 sentences**
- **End with a question** — invites discussion
- **Link at the very end** — after providing value
- **Never start with "Hey r/subreddit!"**
- **Admit flaws** — "it's not perfect but..." reads as authentic

### Example postBody
```
been building my app for a couple months now and the irony isn't lost on me — i built a tool to solve a problem i was spending hours on every day.

but i'm curious how other founders handle this. like genuinely, what does your launch day distribution workflow look like?

because mine used to be:
- write the announcement
- rewrite it for twitter (shorter, punchier)
- rewrite it again for linkedin (more professional)
- rewrite it again for reddit (more casual, no marketing speak)
- resize all the assets
- schedule everything
- realize i forgot a platform
- scramble

by the time i was done distributing, i had zero energy left to actually build.

what's your process? do you just pick 1-2 platforms and ignore the rest?

if you want to see what i ended up building: <your-app-url>
```

## Post Blueprint Structure

```json
{
  "format": "text-thread",
  "text": "Post title (the hook — max 300 chars)",
  "postBody": "Full post body — genuine, value-first, link at end",
  "source": "x-research"
}
```

## Self-Improvement Thresholds

- **Tier 1 (double down):** 100+ engagement (score + comments×3)
- **Tier 2 (keep):** 30+ engagement
- **Drop threshold:** <10 engagement
- **Individual drop:** <3 engagement

### Metrics Tracked
score, upvotes, upvoteRatio, comments
