---
name: twitter
description: Automate Twitter/X marketing for your app with single tweets and threads. Most casual tone of all platforms. Text-only — no images. Use when creating tweets, analyzing engagement, or managing Twitter content strategy.
---

# Twitter/X Marketing

Automate Twitter marketing with single tweets and threads. Twitter is where your core audience lives — indie hackers, developers, startup founders.

## Pipeline Architecture

All platforms share a common engine at `~/dropspace/private/`. No per-platform scripts — everything runs through shared engines with platform config from `platforms.js`.

**Data:** `~/dropspace/apps/{app}/twitter/` (strategy.json, posts.json, failures.json, research/)
**App config:** `~/dropspace/apps/{app}/app.json`

### Key Scripts (all in `~/dropspace/private/`)
```bash
# Create a tweet/thread (auto-picks from queue)
node engines/create-text-post-engine.js --app <APP> --platform twitter --next --schedule "2026-03-04T14:30:00Z"

# Self-improve (analytics + strategy optimization)
node engines/self-improve-engine.js --app <APP> --platform twitter --days 14

# Validate setup

# Add posts to queue
echo '{"posts":[...],"notes":"..."}' | node scripts/add-posts.js --app <APP> --platform twitter
```

## Twitter Details

- **Text-only** — no images, no slideshows
- **2 posts/day** at 9:30 AM and 3:00 PM ET
- **Two formats:** single tweets (≤280 chars) + threads (≤1,680 chars total)
- **0-1 hashtags** (#buildinpublic is the only one that matters)
- **Max 2 emoji**
- **Direct links** fine, no algorithm penalty
- **UTM:** `<configured in app.json utmTemplate>

## Post Types

| Type | Frequency | Format | Description |
|------|-----------|--------|-------------|
| hot-take | 25% | single | Punchy, contrarian, 1-2 sentences |
| build-in-public | 25% | single or thread | Honest update, real numbers |
| thread | 20% | thread | Structured breakdown, 3-6 tweets |
| question | 15% | single | Genuine, drives replies |
| ship-it | 15% | single | Launch announcement + link |

## Thread Format

The pipeline natively supports threads via `platform_contents.twitter.thread` — an array of strings where each element is one tweet (≤280 chars, max 6 tweets).

```json
{
  "platform_contents": {
    "twitter": {
      "thread": [
        "unpopular opinion: most founders spend 3 hours crafting launch posts that get 12 impressions 🧵",
        "the problem isn't the content. it's that you're posting to ONE platform and hoping for the best.",
        "i built this because i was tired of rewriting the same announcement 9 times.",
        "now i write one description, AI generates platform-native content, and i hit publish once.",
        "try it free → <your-app-url>
      ]
    }
  }
}
```

Thread rules:
- First tweet MUST end with 🧵
- Each tweet ≤280 chars
- Max 6 tweets
- Don't number tweets (1/, 2/) — feels corporate

## Content Rules

### Tone
Most casual of all platforms. Write like you're thinking out loud.
- **Lowercase always**
- **Fragments ok** — "shipped it. feels good."
- **Personality > polish**
- **No marketing-speak** — never "excited to announce", "game-changing"
- **Like texting a thought you had in the shower**

### Post Body Format
All Twitter posts default to thread format. Structure `postBody`:
- **Separate each tweet with `\n\n`** (double newline = tweet boundary)
- **Tweet 1 = hook** — standalone, scroll-stopping
- **Tweet 2-4 = story/argument** — one idea per tweet
- **Last tweet = CTA** — link to <your-app-url>
- **3-6 tweets total** (sweet spot 4-5)
- **Each tweet ≤ 280 chars**

### Example postBody
```
unpopular opinion: most indie hackers don't have a product problem. they have a distribution problem.

you ship something great. then spend 4 hours rewriting the same post for twitter, reddit, linkedin, producthunt...

by the time you're done announcing, you're too drained to talk to the people who actually showed up.

that's backwards. the distribution part should take 30 seconds, not 3 hours.

<your-app-url>
```

## Post Blueprint Structure

```json
{
  "format": "text-thread",
  "text": "Hook text (the first tweet / scroll-stopper)",
  "postBody": "Full thread content — tweets separated by \\n\\n",
  "source": "x-research"
}
```

## Self-Improvement Thresholds

- **Tier 1 (double down):** 10,000+ avg impressions
- **Tier 2 (keep):** 2,000+ avg impressions
- **Drop threshold:** <500 avg impressions
- **Individual hook drop:** <100 impressions
- **Winner for variations:** 2,000+ impressions

### Metrics Tracked
impressions, likes, retweets, replies, quotes, bookmarks, urlClicks, profileClicks
