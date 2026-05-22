# Meta Ads CLI Paid Distribution Plan

This adds Meta paid distribution as a controlled layer on top of the existing organic content pipeline.

## Architecture

Keep Meta Ads CLI as a standalone operator capability, then call it from markus through a thin adapter.

- Standalone skill: `meta-ads` owns install/auth checks, account discovery, campaign/ad set/ad creation, reporting, pause/resume, and spend guardrails.
- markus adapter: `core/meta-ads.js` and `scripts/meta-*.js` read app config, suggest organic boost candidates, prepare local draft intents, and report state.
- Dropspace product surface: later, after the internal loop works.

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

## Implemented Slice

- `scripts/meta-suggest-boosts.js` scans recent Instagram/Facebook post history and saves candidates to `paid/meta-candidates.json`.
- `scripts/meta-create-draft.js` prepares a local draft intent from a candidate. It only calls the Meta Ads CLI with `--execute`, and requested campaigns are paused.
- `scripts/meta-report.js` writes local paid-distribution state to `reports/meta-paid-distribution.md`.
- `core/meta-ads.js` centralizes config parsing, candidate scoring, local state paths, and CLI invocation.

## Workflow

1. Organic posts publish through the existing schedule-day flow.
2. @meta-suggest-boosts.js@ scans recent eligible posts and produces candidates.
3. @meta-create-draft.js@ prepares a draft intent or, with explicit execution, calls the Meta Ads CLI to create paused campaign resources.
4. Slack approval can later launch spend for a specific candidate and budget.
5. @meta-report.js@ summarizes candidates, drafts, and tracked campaigns.

No script should launch paid spend directly from performance data.

## Guardrails

- Default `enabled: false`.
- Approval required by default.
- Never exceed `dailyBudgetCap` or `lifetimeBudgetCap`.
- Never modify completed organic launches.
- Never delete and recreate Meta resources when an update endpoint exists.
- Use each app's `notifications` target for approval and reports.
- Do not include private account IDs in the public template.

## Next Implementation Steps

1. Create the `meta-ads` skill in the config repo.
2. Add disabled `paidDistribution.meta` config to live Dropspace and iris app configs once account IDs are known.
3. Replace the provisional CLI command shape in `core/meta-ads.js` with the exact Meta Ads CLI command syntax after local auth is verified.
4. Add Slack reaction approval handling before any campaign is unpaused or budgeted.
