# FORMAT.md — Content Rules

**All generated text must follow `ANTI-PATTERNS.md`.** Read it before writing anything.

## Voice

- **Lowercase always.** Even at the start of sentences.
- Write like a real person sharing something interesting — not a brand announcing a product.
- Casual, curious, genuine. The voice of a smart builder who actually uses the thing.
- Never use: "excited to share," "thrilled to announce," "game-changer," "revolutionary"
- Numbers hook better than adjectives. "3 hours saved" not "massive time savings"

## General Rules

- Trust test: would you engage with this if you had no interest in the product? If no, it's a pitch.
- Your product is context, not the pitch. Max 2 mentions per post.
- No hardcoded metrics (user counts, revenue) — all content must be evergreen.
- No roadmap promises. Only what exists today.

## Platform-Specific

### TikTok / Instagram — Visual Formats

**story-slideshow** (default) — 6-slide story carousel. Locked scene, changing mood per slide.
- Slide 1 = scroll-stopper. Must work without any context.
- Tell a story across slides. Don't just list bullet points.
- Think: problem → realization → solution → outcome.
- CTA slide is auto-generated — don't put CTA in your content slides.
- Scenes feel real, not stock-photo perfect. Everyday environments.

### TikTok / Instagram — Video Formats (optional, requires Fal.ai + FFmpeg)

**ugc-reaction** — 4-second AI-generated UGC selfie clip (frustrated user holding phone, SILENT reaction) stitched with 8-second product demo. 12 seconds total. TikTok-native feel.
- Describe a raw, front-facing camera selfie-style scene. Frustrated reaction. No speaking.
- Video prompt must be under 500 chars.

**ugc-talking** — 8-second version of ugc-reaction where the person speaks on camera. The video prompt MUST include: `the character says "[LINE]"` where LINE is a short frustrated statement about the problem your product solves.
- Example prompt: "person sitting at desk, holding phone, looking frustrated, the character says \"bro I just spent 2 hours copy-pasting the same post to 9 different apps\""
- Keep the spoken line under 15 words. Casual, first-person, TikTok rant energy.
- Video prompt must be under 500 chars.

Both video formats use Veo 3.1 via fal.ai. To activate, ensure `FAL_KEY` is set and `ffmpeg` is installed.

Configure your demo clip in app.json:
```json
"demoClip": {
  "driveFileId": "YOUR_GOOGLE_DRIVE_FILE_ID",
  "driveFolderId": "YOUR_FOLDER_ID"
}
```
The demo clip can be any length — the pipeline stitches the AI clip + your full demo. The self-improve engine can activate video formats as experiments.

### Facebook
- Same visual format as TikTok/Instagram (story-slideshow).
- Slightly warmer tone — more community-focused.
- Skews toward shareable insights and relatable moments.

### Twitter
- text-single for sharp observations, threads for full stories.
- First line must stand alone as a screenshot.
- No hashtag spam. 1 max (#buildinpublic is fine for build updates).
- Max 2 emoji per tweet.

### LinkedIn
- Professional but still your voice — not corporate.
- 150–200 words. Arrow lists (→) work well.
- Hook in the first line. Expand in the body. Land with a question or CTA.
- Weekdays only — no weekend posts.

### Reddit
- No hashtags. No emoji. No marketing language.
- Write like you're telling a friend in the subreddit something useful.
- Title = hook. Body = story + value + soft mention.
- Don't pitch. The sub will reject it.

## What to Customize

Edit the sections above to reflect what you've learned about your audience.
The self-improve loop will suggest changes in strategy notes — use those insights to refine these rules over time.
