/**
 * Meta paid-distribution helpers.
 *
 * This layer is intentionally conservative: it can identify boost candidates
 * and prepare draft intents without starting spend by default.
 */

const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('./paths');
const { loadJSON, saveJSON } = require('./helpers');

const DEFAULT_META_CONFIG = {
  enabled: false,
  approvalRequired: true,
  dailyBudgetCap: 20,
  lifetimeBudgetCap: 100,
  defaultObjective: 'traffic',
  boostRules: {
    sourcePlatforms: ['instagram', 'facebook'],
    minOrganicEngagementRate: 0.03,
    maxAgeHours: 72,
  },
};

function getMetaConfig(appConfig) {
  const meta = appConfig?.paidDistribution?.meta || {};
  return {
    ...DEFAULT_META_CONFIG,
    ...meta,
    boostRules: {
      ...DEFAULT_META_CONFIG.boostRules,
      ...(meta.boostRules || {}),
    },
  };
}

function paidDir(appName) {
  return path.join(paths.appRoot(appName), 'paid');
}

function candidatesPath(appName) {
  return path.join(paidDir(appName), 'meta-candidates.json');
}

function draftsPath(appName) {
  return path.join(paidDir(appName), 'meta-drafts.json');
}

function campaignsPath(appName) {
  return path.join(paidDir(appName), 'meta-campaigns.json');
}

function loadPosts(appName, platform) {
  const data = loadJSON(paths.postsPath(appName, platform), { posts: [] });
  if (Array.isArray(data)) return data;
  return Array.isArray(data.posts) ? data.posts : [];
}

function postTime(post) {
  const raw = post.publishedAt || post.published_at || post.createdAt || post.created_at || post.date;
  if (!raw) return null;
  const d = raw.length === 10 ? new Date(raw + 'T12:00:00-05:00') : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function metricNumber(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') return metricNumber(value.total);
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function postMetrics(post) {
  const impressions = metricNumber(post.views || post.impressions || post.reach);
  const interactions =
    metricNumber(post.likes) +
    metricNumber(post.comments) +
    metricNumber(post.shares) +
    metricNumber(post.saved) +
    metricNumber(post.reactions) +
    metricNumber(post.retweets) +
    metricNumber(post.replies) +
    metricNumber(post.quotes) +
    metricNumber(post.bookmarks) +
    metricNumber(post.engagement);

  let engagementRate = 0;
  if (impressions > 0) engagementRate = interactions / impressions;
  else if (typeof post.engagementRate === 'number') engagementRate = post.engagementRate > 1 ? post.engagementRate / 100 : post.engagementRate;

  return { impressions, interactions, engagementRate };
}

function candidateId(appName, platform, post) {
  const source = [
    appName,
    platform,
    post.launchId || '',
    post.postUrl || '',
    post.text || post.caption || post.postBody || '',
  ].join('\n');
  return crypto.createHash('sha1').update(source).digest('hex').slice(0, 12);
}

function normalizeCandidate(appName, appConfig, platform, post, now = new Date()) {
  const published = postTime(post);
  const metrics = postMetrics(post);
  const ageHours = published ? (now.getTime() - published.getTime()) / 36e5 : null;
  const text = post.caption || post.postBody || post.text || '';
  const budget = Math.min(getMetaConfig(appConfig).dailyBudgetCap || 20, 20);

  return {
    id: candidateId(appName, platform, post),
    app: appName,
    appName: appConfig.name || appName,
    platform,
    launchId: post.launchId || null,
    postUrl: post.postUrl || null,
    text,
    format: post.format || null,
    publishedAt: published ? published.toISOString() : null,
    ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10,
    metrics,
    suggested: {
      objective: getMetaConfig(appConfig).defaultObjective || 'traffic',
      dailyBudget: budget,
      reason: 'organic engagement ' + (metrics.engagementRate * 100).toFixed(2) + '%',
    },
    sourcePost: post,
    status: 'candidate',
    createdAt: now.toISOString(),
  };
}

function findBoostCandidates(appName, options = {}) {
  const appConfig = paths.loadAppConfig(appName);
  if (!appConfig) throw new Error('No app.json found for ' + appName);

  const meta = getMetaConfig(appConfig);
  if (!meta.enabled && !options.includeDisabled) {
    return {
      app: appName,
      enabled: false,
      candidates: [],
      summary: 'Meta paid distribution is disabled for ' + appName,
    };
  }

  const now = options.now || new Date();
  const maxAgeHours = Number(options.sinceHours ?? meta.boostRules.maxAgeHours ?? 72);
  const minRate = Number(options.minEngagementRate ?? meta.boostRules.minOrganicEngagementRate ?? 0);
  const sourcePlatforms = options.platforms || meta.boostRules.sourcePlatforms || ['instagram', 'facebook'];

  const candidates = [];
  for (const platform of sourcePlatforms) {
    for (const post of loadPosts(appName, platform)) {
      if (!post || !post.postUrl) continue;
      const published = postTime(post);
      if (!published) continue;
      const ageHours = (now.getTime() - published.getTime()) / 36e5;
      if (ageHours < 0 || ageHours > maxAgeHours) continue;
      const metrics = postMetrics(post);
      if (metrics.engagementRate < minRate) continue;
      candidates.push(normalizeCandidate(appName, appConfig, platform, post, now));
    }
  }

  candidates.sort((a, b) => {
    if (b.metrics.engagementRate !== a.metrics.engagementRate) return b.metrics.engagementRate - a.metrics.engagementRate;
    return b.metrics.interactions - a.metrics.interactions;
  });

  return {
    app: appName,
    enabled: !!meta.enabled,
    sourcePlatforms,
    maxAgeHours,
    minOrganicEngagementRate: minRate,
    candidates,
    summary: candidates.length + ' Meta boost candidate(s) for ' + appName,
  };
}

function saveCandidates(appName, result) {
  const existing = loadJSON(candidatesPath(appName), { candidates: [] });
  const byId = new Map((existing.candidates || []).map(c => [c.id, c]));
  for (const candidate of result.candidates || []) byId.set(candidate.id, { ...byId.get(candidate.id), ...candidate });
  const data = {
    app: appName,
    updatedAt: new Date().toISOString(),
    candidates: Array.from(byId.values()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  };
  saveJSON(candidatesPath(appName), data);
  return data;
}

function loadCandidate(appName, id) {
  const data = loadJSON(candidatesPath(appName), { candidates: [] });
  const candidate = (data.candidates || []).find(c => c.id === id);
  if (!candidate) throw new Error('No Meta boost candidate ' + id + ' for ' + appName);
  return candidate;
}

function validateMetaReady(appConfig, meta) {
  const missing = [];
  if (!meta.adAccountId) missing.push('paidDistribution.meta.adAccountId');
  if (!meta.businessId) missing.push('paidDistribution.meta.businessId');
  if (!meta.defaultObjective) missing.push('paidDistribution.meta.defaultObjective');
  if (!appConfig?.url) missing.push('url');
  return missing;
}

function makeDraftIntent(appName, candidate, appConfig, meta) {
  return {
    id: 'draft_' + candidate.id,
    app: appName,
    candidateId: candidate.id,
    status: 'draft',
    createdAt: new Date().toISOString(),
    approvalRequired: meta.approvalRequired !== false,
    adAccountId: meta.adAccountId || null,
    businessId: meta.businessId || null,
    pixelId: meta.pixelId || null,
    objective: candidate.suggested?.objective || meta.defaultObjective || 'traffic',
    dailyBudget: Math.min(candidate.suggested?.dailyBudget || meta.dailyBudgetCap || 20, meta.dailyBudgetCap || 20),
    destinationUrl: appConfig.url,
    sourcePostUrl: candidate.postUrl,
    primaryText: candidate.text,
  };
}

function saveDraft(appName, draft) {
  const data = loadJSON(draftsPath(appName), { drafts: [] });
  const drafts = (data.drafts || []).filter(d => d.id !== draft.id);
  drafts.unshift(draft);
  saveJSON(draftsPath(appName), { app: appName, updatedAt: new Date().toISOString(), drafts });
  return draft;
}

function runMetaAdsCli(args, options = {}) {
  const command = options.command || process.env.META_ADS_CLI_COMMAND || 'ads';
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    command,
    args,
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : null,
  };
}

function createDraft(appName, candidateId, options = {}) {
  const appConfig = paths.loadAppConfig(appName);
  if (!appConfig) throw new Error('No app.json found for ' + appName);
  const meta = getMetaConfig(appConfig);
  const candidate = loadCandidate(appName, candidateId);
  const draft = makeDraftIntent(appName, candidate, appConfig, meta);
  const missing = validateMetaReady(appConfig, meta);

  if (!options.execute) {
    return saveDraft(appName, {
      ...draft,
      status: 'prepared',
      missing,
      note: 'Prepared locally only. Re-run with --execute after credentials are configured to call Meta Ads CLI.',
    });
  }

  if (missing.length) {
    return saveDraft(appName, {
      ...draft,
      status: 'blocked',
      missing,
      error: 'Missing required config: ' + missing.join(', '),
    });
  }

  const cliArgs = [
    'campaigns',
    'create',
    '--ad-account-id', meta.adAccountId,
    '--name', (appConfig.name || appName) + ' boost ' + candidate.id,
    '--objective', draft.objective,
    '--status', 'PAUSED',
    '--daily-budget', String(draft.dailyBudget),
    '--destination-url', draft.destinationUrl,
    '--source-post-url', draft.sourcePostUrl,
    '--primary-text', draft.primaryText,
  ];

  const cli = runMetaAdsCli(cliArgs, options);
  return saveDraft(appName, {
    ...draft,
    status: cli.ok ? 'created-paused' : 'cli-failed',
    cli,
  });
}

function report(appName) {
  const candidates = loadJSON(candidatesPath(appName), { candidates: [] });
  const drafts = loadJSON(draftsPath(appName), { drafts: [] });
  const campaigns = loadJSON(campaignsPath(appName), { campaigns: [] });
  const lines = [];
  lines.push('# Meta paid distribution: ' + appName);
  lines.push('');
  lines.push('Candidates: ' + (candidates.candidates || []).length);
  lines.push('Drafts: ' + (drafts.drafts || []).length);
  lines.push('Tracked campaigns: ' + (campaigns.campaigns || []).length);
  lines.push('');
  for (const candidate of (candidates.candidates || []).slice(0, 10)) {
    lines.push('- ' + candidate.id + ' ' + candidate.platform + ': ' + (candidate.metrics.engagementRate * 100).toFixed(2) + '% engagement - ' + candidate.postUrl);
  }
  return {
    app: appName,
    generatedAt: new Date().toISOString(),
    markdown: lines.join('\n'),
    candidates: candidates.candidates || [],
    drafts: drafts.drafts || [],
    campaigns: campaigns.campaigns || [],
  };
}

module.exports = {
  getMetaConfig,
  findBoostCandidates,
  saveCandidates,
  loadCandidate,
  createDraft,
  report,
  paths: { paidDir, candidatesPath, draftsPath, campaignsPath },
};
