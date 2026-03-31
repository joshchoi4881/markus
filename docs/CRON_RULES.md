# Cron Agent Rules

Read this file before executing any cron task. These rules are non-negotiable.

## Self-Healing Protocol

When a script fails or produces an incorrect result:

1. **Read the error** — understand the stack trace or output
2. **Read the script source** — find the bug (`~/dropspace/private/`)
3. **Fix the script** — make the minimal edit to fix the bug
4. **Log the fix** — append to the app's `failures.json`:
   ```json
   { "rule": "description of what was wrong and how it was fixed", "date": "ISO", "source": "self-heal", "fix": "file:line changed" }
   ```
5. **Retry once** — run the fixed script. If it fails again, STOP and report both errors.

### What you CAN fix:
- Script bugs (wrong args, bad parsing, missing flags)
- Path issues (`/root/` vs `/home/<user>/`, missing dirs)
- Missing env vars (add the correct `export` + `op read` pattern)
- JSON parse errors in data files (malformed posts.json, strategy.json)
- Wrong API call patterns
- Incorrect script invocations (wrong flags, missing options)

### What you should NOT fix (report instead):
- API authentication failures (token expired/revoked)
- External service outages (Dropspace, Instagram, Stripe down)
- Rate limits (wait, don't hack around them)
- Fundamental architecture issues (report to the user)

## Autonomous Learning

After every run — success or failure — review what happened and improve:

1. **Log failures to `failures.json`** — every error, warning, or unexpected behavior becomes a rule
2. **Fix scripts proactively** — if you notice a bug, wrong default, missing validation, or edge case that could break in the future, fix it NOW. Don't wait for it to break.
3. **Update strategy.json** — if the hook queue is low, CTA isn't working, or posting times need adjustment, update them based on the data
4. **Report what you learned** — include a "Lessons" section in your report: what broke, what you fixed, what you'd do differently

The goal: each run should leave the system better than it found it.

## Multi-App Architecture

The pipeline supports multiple apps, each discovered from `~/dropspace/apps/`. Each app has:
- `app.json` — identity, integrations, platform config, posting times, notifications, skipDays
- `pipelineType` — either `ai-generated` (self-improve + AI engines) or `manual` (pre-built launches, schedule only)

**ai-generated apps** run the full pipeline: self-improve → post generation → scheduling → publishing.
**manual apps** skip self-improve and AI engines — their queue entries already have a `launchId`. schedule-day just PATCHes the launch with a scheduled date.

Per-app notification routing is configured in `app.json` (`notifications: {channel, target}`). Supports slack, telegram, discord, etc.

**skipDays** in `app.json` — array of day numbers (0=Sunday, 6=Saturday) to skip posting entirely. Checked by schedule-day.js. Currently empty for all apps (posts go out every day).

## Pipeline Architecture

Six sequential crons run the full pipeline nightly:

1. **midnight (12:00 AM ET)** — monitoring, reports, workspace maintenance, post asset cleanup
2. **x-research (12:30 AM ET)** — searches X, distributes signals to all platforms
3. **self-improve-all (1:00 AM ET)** — single orchestrator session runs all ai-generated apps' self-improve scripts, then generates posts for ALL platforms with full cross-platform context. 60 min timeout.
4. **schedule-day (2:00 AM ET)** — creates ALL posts for the day in one pass. For ai-generated apps, runs engines on-demand. For manual apps, PATCHes existing launches with scheduled dates. 40 min (2400s) timeout.
5. **engage (1:00 PM ET)** — X engagement run. Finds relevant conversations, drafts replies for approval. Separate from nightly pipeline.

## Pipeline Dependency Checks

The cron agent checks upstream dependencies inline before running each stage. Self-improve checks x-research signals freshness (warns if stale). Schedule-day checks queue depth before creating posts.

## Data Layout

All automation data lives under `~/dropspace/apps/{app}/`:
```
~/dropspace/apps/{app}/
├── app.json                  # App config (identity, integrations, platform posting times, notifications, skipDays)
├── TRACKING.md               # Auto-refreshed post performance dashboard (all platforms)
├── shared-failures.json      # Cross-platform failure rules
├── insights.json             # Cross-platform strategy notes (LLM memory between runs)
├── x-research-signals.json   # Latest X research output
├── config/        # Content guidelines (all apps)
│   ├── FORMAT.md             # Voice, content rules, anti-patterns
│   ├── POSTING.md            # Schedule, API workflow, privacy settings
│   └── {project}/            # Per-project/event folders
│       └── CONTEXT.md        # Source material details, collaborators
├── {platform}/               # Per-platform data (strategy.json, posts.json, etc.)
│   ├── strategy.json         # Queue, notes (posting times in app.json)
│   ├── posts.json            # Historical performance
│   ├── failures.json         # Directive failure rules (auto-generated rules replaced by correlations data)
│   ├── experiments.json      # Format experiment tracking
│   ├── pending-batches.json  # (visual only)
│   └── posts/                # Image assets
└── reports/                  # Cross-platform analysis reports
```

Platform config (metrics, validation, content rules) lives in `platforms.js` — a single registry replacing 27 per-platform wrapper scripts.

Format definitions live in `formats.js` — the `FORMATS` registry defines all content formats across three generator types: ai-visual, ai-text, ai-video, drive-photos, drive-clips, manual. The `FORMAT_PLATFORMS` mapping controls which formats are allowed on which platforms.

`correlations.js` replaces text-based failure rules with data-driven correlation analysis — it identifies patterns that correlate with high/low engagement automatically from posts.json metrics. Directive rules (e.g. "never mention competitor X") still live in `failures.json`.

All scripts use `--app <name> --platform <platform>` instead of `--dir`. Paths resolve via `paths.js`.

### Queue Data Structure

The post queue lives in `strategy.json` under `postQueue` (NOT in `posts.json`):
- `strategy.json` → `{ postQueue: [...], notes: "...", ... }` — active queue + strategy
- `posts.json` → `{ posts: [...] }` — historical posting log (used for dedup, not scheduling)

**Pre-configured apps:** Queue entries have a `launchId` field. schedule-day PATCHes these launches with a scheduled date instead of running an engine.

**Never manually edit strategy.json to fix queue issues.** Use `add-posts.js` for adding posts. It handles dedup, limits, and atomic writes.

### Char Limits

`add-posts.js` enforces char limits at write time — posts exceeding limits are rejected before entering the queue. The LLM should still aim for the limits, but exceeding them no longer pollutes the queue.

## Scheduling Architecture

schedule-day cron (2:00 AM ET) creates ALL posts for the day in one pass:
1. `schedule-day.js` is **fully deterministic** — it reads `app.json` for platforms and posting times, then calls the shared engines directly with `--schedule`. No per-platform wrapper scripts needed.
2. For **manual posts** (queue entries with `launchId`), schedule-day PATCHes the existing launch via Dropspace API to set the scheduled date. No engine is run.
3. ALL platforms use `--schedule "<ISO datetime>"` — Dropspace auto-publishes at the scheduled time.
4. TikTok posts are scheduled with `SELF_ONLY` privacy + `auto_add_music: false`. The user gets a notification, opens TikTok, swaps sound for trending, changes privacy to public.
5. LinkedIn is automatically skipped on weekends (checked by schedule-day.js).
6. **skipDays** in app.json skips all platforms for specified days of the week.
7. When posts publish, Dropspace fires a webhook → OpenClaw hook session → Slack report. This is the ONLY notification path.

**Do NOT use `--publish` in cron jobs.** Use `--schedule` only.
**Do NOT send Slack messages from schedule-day.** The webhook handles all publish notifications. The cron's only job is creating scheduled launches.

## Launch Lifecycle Rules

### ONE launch per manifest entry
- The schedule-day cron creates one launch per entry in the manifest. Never duplicate a slot.
- If format is wrong or content is bad, REPORT the error. Do NOT create a second launch.

### Launch Status Reference

Statuses in lifecycle order: `draft` → `manual` → `trigger` → `scheduled` → `running` → `completed` / `partial` / `failed` / `cancelled`

- **`draft`**: Initial creation. Not actionable in dashboard. Can publish via API.
- **`manual`**: Ready, waiting for manual publish. Shows action buttons in dashboard. **Not** auto-published by cron.
- **`trigger`**: Ready, waiting for explicit trigger. Shows action buttons. **Not** auto-published by cron.
- **`scheduled`**: Will auto-publish when `scheduled_date ≤ now`. The publish cron **only** picks up this status.
- **`running`**: Currently publishing. Do not touch.
- **`completed`/`partial`/`failed`/`cancelled`**: Terminal states.

**Status is auto-derived on PATCH.** The server overrides your requested status based on launch configuration:
- Has posting accounts (`user_platform_accounts`/`dropspace_platforms`) + `scheduled_date` → `scheduled`
- Has posting accounts + no `scheduled_date` → `trigger`
- Has content + no posting accounts → `manual`
- You **cannot force `manual`** on a launch with posting accounts — it auto-becomes `trigger`.

**To unschedule without losing settings:** PATCH with `{"scheduled_date": null}`. Status auto-becomes `trigger`. All `platform_contents`, `tiktok_settings`, media preserved. Do NOT set to `draft` (hides dashboard actions) or DELETE (soft-deletes, hard to recover).

**To pause a scheduled launch:** PATCH `{"scheduled_date": null}`. Resume by PATCHing a new `scheduled_date` (auto-becomes `scheduled`).

**`POST /launches/:id/publish` triggers IMMEDIATE publishing** regardless of `scheduled_date`. Never call this on scheduled launches unless you want them published right now.

### Never retry a published launch
- If a launch has been created and published (status: completed, partial, or any non-draft status), it is DONE. Do not create another one.
- A bad post is better than a duplicate post.

### Wait for launch resolution
- Publish returns 202 (async). It is NOT done when you get the response.
- Poll `GET /launches/:id/status` for terminal status: completed, partial, failed, cancelled.
- Non-terminal statuses (running, pending, publishing) mean it's still working — keep polling.
- Poll command: `curl -s "https://api.dropspace.dev/launches/$LAUNCH_ID/status" -H "Authorization: Bearer $KEY"`
- Check `.data.launch_status` for overall status, `.data.posting_logs[]` for per-platform results.
- Do NOT assume success from the publish 202 response.
- Do NOT timeout and retry while a launch is still running/pending.
- The `verifyPublish()` function in `api.js` handles this automatically — use it.

### Retry failed platforms
- If a launch has status `partial` (some platforms succeeded, some failed), use `POST /launches/:id/retry`
- This retries ONLY the failed platforms — doesn't touch successful ones.
- The `retryFailedPlatforms()` function in `api.js` handles this.
- Only retry once. If it fails again, report.

### Never retry a running launch
- If a launch exists with status `pending`, `publishing`, or `running`, do NOT create a new one. Wait for it to finish.
- If you hit the idempotency check (launch exists for this hook today), STOP.

## File Writing Rules

- **Do NOT write temp files outside the workspace.** The `write` tool blocks paths outside the agent's workspace.
- Use `exec` with `cat > file << 'EOF'` for files outside workspace, or pass data via environment variables / CLI args.
- **Slide texts, slide prompts, and captions are already in strategy.json queue entries.** The create-post scripts read them automatically via `--next`. Never write temp files for slide text data.
- If you need to pass large data to a script, use stdin pipes (`echo '...' | node script.js`) or env vars.

## Env Var Loading

Always load env vars before running scripts:
```bash
export OP_SERVICE_ACCOUNT_TOKEN="$(grep OP_SERVICE_ACCOUNT_TOKEN ~/.bashrc | cut -d'"' -f2)"
export DROPSPACE_API_KEY="$(op read 'op://your-vault/DROPSPACE_API_KEY/password')"
export OPENAI_API_KEY="$(op read 'op://your-vault/OPENAI_API_KEY/password')"
export STRIPE_SECRET_KEY="$(op read 'op://your-vault/STRIPE_SECRET_KEY/password')"
export SUPABASE_ACCESS_TOKEN="$(op read 'op://your-vault/SUPABASE_ACCESS_TOKEN/password')"
```

## Path Rules

- Data: `~/dropspace/apps/{app}/{platform}/` (resolved via `paths.js`)
- App config: `~/dropspace/apps/{app}/app.json`
- Shared code: `~/dropspace/private/`
- Always pass `--app <name> --platform <platform>`. Paths resolve via `paths.js`.

## Deleting Bad Posts

If you discover a duplicate, broken, or wrong-format post AFTER it was published:

1. Get the launch ID and posting log IDs via `GET /launches/:id/status`
2. Delete individual posts: `DELETE /launches/:id/posts/:logId` via Dropspace API
3. Or delete all posts for a launch: `DELETE /launches/:id/posts`
4. **Works on:** Twitter, Facebook, LinkedIn, Reddit
5. **Does NOT work on:** Instagram, TikTok — report these for manual deletion
6. Log what you deleted and why to `failures.json`

Use this to clean up duplicates, wrong-format posts, or broken content. A clean feed is better than a cluttered one.

## Post Generation from Research Signals

Self-improve scripts output `--- POSTS_NEEDED ---` blocks with research signals when the post queue needs filling. **YOU generate the posts** — don't call any external API for this.

When you see a `POSTS_NEEDED` block:

1. Read the JSON: `platform`, `slotsAvailable`, `product`, `researchSignals`, `recentPosts` (all posts from past 14 days with full details + metrics), `existingQueue`, `previousNotes`
2. **Read the platform's SKILL.md Content Rules section** — follow the tone, format, and example exactly
3. Analyze `recentPosts` — what worked, what didn't, which visual styles performed, which narratives resonated. Read `previousNotes` for your reasoning from last run. Build on it.
4. Generate `slotsAvailable` complete post blueprints
5. Save posts AND notes in one command via `add-posts.js` (NEVER edit strategy.json directly):
   ```bash
   echo '{"posts":[...], "notes":"Your strategy notes...", "crossNotes":"Insights for other platforms..."}' | \
     node ~/dropspace/private/scripts/add-posts.js --app dropspace --platform tiktok
   ```

**Post blueprint structure:**
- **Visual platforms (TikTok, Instagram):** `{ text, slideTexts, slidePrompts, caption, format }`
- **Text platforms (Twitter, LinkedIn, Reddit, Facebook):** `{ text, postBody, format }`
- **Video formats (TikTok, Instagram):** `{ text, videoPrompt, caption, format }` — videoPrompt is the generation prompt (ugc-reaction) or the spoken script (ugc-talking)

**Post rules:**
- `text` = the hook (first line / scroll-stopper). Under 100 chars.
- `format` = the content format name from formats.js FORMATS registry. Each format has a platform allowlist in `FORMAT_PLATFORMS` — only use formats allowed for the target platform. **Required.** Posts with killed or disallowed formats are rejected by `add-posts.js`. There is no hardcoded default — the format is resolved dynamically via `resolveDefaultFormat()` (most-used format in posts.json > first format of matching type).
- `postBody` = full post content, formatted per platform Content Rules (thread-ready for Twitter, story format for Reddit, etc.)
- `slideTexts` = array of text overlays matching the format's slide count. If format has `ctaSlide: true`, LLM includes CTA as the LAST slideText/slidePrompt (story-slideshow=6). If `ctaSlide: false`, no CTA image — CTA in caption only.
- `slidePrompts` = array of image generation prompts, same count as slideTexts. **YOU own the visual strategy.** Each prompt is a standalone, complete description of the image to generate — scene, style, mood, lighting, composition, color palette. No templates. Think like a creative director. Use performance data to inform visual decisions.
- `caption` = long storytelling caption for visual posts
- Must be specifically about the product (not generic SaaS advice)
- Never copy tweets verbatim — adapt the *angle*, not the words
- Never mention competitors by name
- **Study `recentPosts`** — all posts from the past 14 days with full content + metrics. You decide what patterns matter.
- Don't duplicate posts already in `existingQueue`
- **Vary visual styles across posts:** photorealistic, illustration, neon, minimalist, documentary, editorial, hand-drawn, cinematic. Different color palettes, different settings, different energy. If everything looks the same, experiment wildly.

**Queue order = posting order.** The LLM outputs posts in the order they should be posted — first in queue = first to post. No scoring, no re-sorting. The LLM already has the performance data and strategic context to make this call. New posts are prepended to the front of the queue via add-posts.js.

## Post Deletion Detection

Dropspace's analytics API now detects when posts are deleted from social platforms. The pipeline handles this automatically:

### How it works
1. **Analytics cron (Dropspace server-side):** Detects deletion during metric refresh (404, 410, platform-specific signals)
2. **self-improve-engine.js:** Reads `is_deleted`, `deletion_reason`, `deleted_detected_at` from analytics response
3. **posts.json:** Stores `isDeleted`, `deletionReason`, `deletedDetectedAt` per post
4. **POSTS_NEEDED:** Deleted posts excluded from `recentPosts` (would poison metrics). Shown separately in `deletedPosts` array so the LLM can adapt strategy.
5. **midnight-report.js:** Includes deletion summary (count by reason and platform)
6. **Webhook:** `post.deleted` event fires in real-time → Slack notification (once Dropspace deploys the event)

### Deletion reasons
| Reason | Meaning | Action |
|--------|---------|--------|
| `not_found` | Post returned 404 | Could be temporary — monitor |
| `gone` | Post returned 410 | Permanently removed |
| `creator_deleted` | Creator deleted it | Intentional — ignore |
| `moderation_removed` | Platform moderation took it down | **Content quality issue** — adjust strategy |
| `account_deleted` | Account was deleted | Check platform connection |
| `spam_filtered` | Flagged as spam | **Content quality issue** — adjust strategy |

### What the LLM sees
In `POSTS_NEEDED`, `deletedPosts` array contains `{ text, date, deletionReason, deletedDetectedAt }`. The LLM instructions tell it to treat `moderation_removed`/`spam_filtered` as content quality signals and adjust accordingly.

## Adding New Formats (Plug-and-Play)

Adding a new content format requires **one change**: add an entry to the `FORMATS` registry in `formats.js`.

```javascript
'my-new-format': {
  type: 'visual',              // or 'text' or 'video'
  generator: 'ai-visual',     // ai-visual | ai-text | ai-video | drive-photos | drive-clips | manual
  description: 'What this format does...',
  slides: 3,                   // visual only: number of content slides (engine appends CTA)
  imageGen: true,              // visual only
  textOverlay: true,           // visual only
  overlayStyle: {              // visual only: text overlay rendering config
    position: 'center',        // upper-third | center | lower-third | top-bottom
    fontScale: 'auto',         // auto | large | impact | fixed-6.5
    stroke: true,
    fill: '#FFFFFF',
    strokeColor: '#000000',
    bg: null,
  },
  slideStructure: 'Optional: describe the slide-by-slide layout for the LLM.',
  ctaImagePrompt: 'Optional: custom CTA slide image prompt.',
}
```

That's it. The engines, scheduling, validation, and format framework all read from FORMATS automatically. No other file changes needed.

**Universal standards (enforced on ALL formats, from Larry's proven playbook):**
- Safe zones: top 10% (TikTok status bar), bottom 20% (TikTok UI) — all positions clamped
- Max text width: 75% of image (85% with background box)
- Outline: 15% of font size (white fill, black stroke)
- Line height: 125%
- Emoji stripped (canvas can't render them)
- Font: Bold Arial
- Portrait only: 1024×1536

**To test a new format:** Use `ADD_CANDIDATE` in strategy notes, then `ACTIVATE_EXPERIMENT`. The experiment system tracks format performance over time.

## Strategy Notes

Notes are saved atomically with posts via stdin JSON to `add-posts.js`. No separate JSON editing needed.

Pass a JSON object via stdin with posts, notes, crossNotes, and failures:
```bash
echo '{"posts":[...], "notes":"Your strategic reasoning...", "crossNotes":"Insights for other platforms...", "failures":["rule1","rule2"]}' | \
  node ~/dropspace/private/scripts/add-posts.js --app dropspace --platform tiktok
```

- **posts**: Array of post objects (required, can be empty `[]` if only saving notes)
- **notes**: Your strategic reasoning for THIS platform. Persists across runs — tomorrow's LLM reads it as `previousNotes` in POSTS_NEEDED. Write what matters: patterns, experiments, what to remember next run.
- **crossNotes**: Insights relevant to OTHER platforms. Shared across all 6 platforms via `~/dropspace/apps/{app}/insights.json`. E.g. "contrarian angles getting 3x engagement" or "photorealistic outperforming illustration."
- **failures**: Array of failure rule strings to append to `{platform}/failures.json`. Use for directive rules only — correlations.js handles data-driven failure detection automatically.

**Experiment commands** in notes are processed BEFORE posts are added. If your notes include `KILL_EXPERIMENT: text-single-v1`, the format is killed before posts are filtered — any text-single posts in the same batch will be rejected.

Notes are optional but CRITICAL for learning between runs. Without notes, every run starts from scratch.

## TikTok: SELF_ONLY Drafts with Trending Sound Workflow

TikTok posts are **scheduled** like all other platforms (using `--schedule`) but with `privacy_level: SELF_ONLY`. This sends them to the user's TikTok inbox as drafts with `auto_add_music: false` (TikTok auto-assigns a sound).

**User workflow:**
1. Open TikTok inbox — drafts are waiting with auto-assigned music
2. Swap the sound for a trending one in the niche
3. Publish

If the user doesn't get to a draft, it just sits — no harm. With 3 posts/day, even publishing 1-2 with trending sounds is a huge reach boost over auto-music.

**Technical:** `tiktokPrivacyLevel: 'SELF_ONLY'` is set in `platforms.js` TikTok config and passed through the visual post engine.

## Reporting

**Your final message IS the report.** OpenClaw's cron delivery system (`delivery.mode: "announce"`) automatically sends your response to the configured Slack channel. Do NOT call the `message` tool to send to Slack — that creates duplicate notifications.

- Write your summary as your last response — cron delivery handles routing
- Only use the `message` tool if you need to send to a DIFFERENT channel than the cron's delivery target (e.g., alerting the user from a cron that delivers to the app channel)
- Never send the same content to both the delivery channel and via `message` — that's what caused duplicate notifications

- Hook used, format
- Launch ID and scheduled time
- Any warnings or errors encountered
- Any script fixes made (what was broken, what you changed)
- Hook queue depth remaining
- **Lessons:** what you learned, what you improved for next time
