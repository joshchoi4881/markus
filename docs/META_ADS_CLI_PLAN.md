# Meta Ads CLI Paid Distribution Plan

This plan adds Meta paid distribution as a controlled layer on top of the existing organic content pipeline.

## Architecture

Keep Meta Ads CLI as a standalone operator capability, then call it from markus through a thin adapter.

- **Standalone skill:** `meta-ads`
  - Owns Meta Ads CLI install checks, auth, account discovery, campaign/ad set/ad creation, reporting, pause/resume, and spend guardrails.
  - Requires explicit approval before spend unless the app config later opts into a strict automatic budget rule.
- **markus adapter:** `scripts/meta-*.js`
  - Reads `paidDistribution.meta` from each app's `app.json`.
  - Converts organic post performance into paid boost candidates.
  - Creates draft or paused Meta campaigns only.
  - Reports candidates and results to the app's configured notification target.
- **Dropspace product surface:** later
  - Once the internal loop works, the same pattern can become a Dropspace feature such as “boost this launch on Meta.”

## Config Contract

Each app may define:

```json
{
  "paidDistribution": {
    "meta": {
      "enabled": false,
      "approvalRequired": true,
      "adAccountId": "",
      "businessId": "",
      "pixelId": "",
      "dailyBudgetCap": 20,
      "lifetimeBudgetCap": 100,
      "defaultObjective": "traffic",
      "boostRules": {
        "sourcePlatforms": ["instagram", "facebook"],
        "minOrganicEngagementRate": 0.03,
        "maxAgeHours": 72
      }
    }
  }
}
```

Config stores rules, caps, and IDs only. Point-in-time metrics stay in analytics sources and reports.

## Workflow

1. Organic posts publish through the existing schedule-day flow.
2. `meta-suggest-boosts.js` scans recent eligible posts and produces candidates.
3. `meta-create-draft.js` creates a paused campaign/ad set/ad through the Meta Ads CLI.
4. Slack approval launches spend for a specific candidate and budget.
5. `meta-report.js` pulls insights and recommends one of: keep, pause, scale, or iterate creative.

No script should launch paid spend directly from performance data. The first implementation must create drafts or paused campaigns only.

## Initial Scripts

- `scripts/meta-suggest-boosts.js`
  - Input: `--app <name>`, optional `--since-hours <n>`
  - Reads app config and platform `posts.json`
  - Outputs candidate posts with source post URL, creative text, platform metrics, and suggested budget
- `scripts/meta-create-draft.js`
  - Input: `--app <name> --candidate-id <id>`
  - Uses the standalone `meta-ads` skill/CLI workflow
  - Creates paused campaign resources
- `scripts/meta-report.js`
  - Input: `--app <name>`
  - Pulls Meta insights for active/paused campaigns created by markus
  - Writes a report under `~/markus/apps/<app>/reports/`

## Guardrails

- Default `enabled: false`.
- Approval required by default.
- Never exceed `dailyBudgetCap` or `lifetimeBudgetCap`.
- Never modify completed organic launches.
- Never delete and recreate Meta resources when an update endpoint exists.
- Use each app's `notifications` target for approval and reports.
- Do not include private account IDs in the public template.

## Phase 1

1. Create the `meta-ads` skill in the config repo.
2. Add disabled `paidDistribution.meta` config to Dropspace and iris.
3. Implement `meta-suggest-boosts.js` for Instagram/Facebook posts only.
4. Manually review candidates before building campaign creation.

## Phase 2

1. Implement paused campaign/ad creation through Meta Ads CLI.
2. Add Slack approval handling.
3. Add daily insight reporting.
4. Run with tiny budgets on one app before expanding.

## Done Criteria

- A disabled app config can be validated without Meta credentials.
- Candidate generation works from local post history.
- Draft campaign creation never starts spend.
- Reports route to the app's configured notification target.
- The workflow is reusable for Dropspace, iris, and future apps without app-specific code paths.
