#!/usr/bin/env node
/**
 * Anti-pattern / correlation engine.
 * Analyzes posts.json to extract structured performance correlations.
 * Replaces text-based failure rules with data the LLM can reason about.
 *
 * Usage:
 *   node correlations.js --app dropspace --platform tiktok
 *   node correlations.js --app dropspace --platform tiktok --json
 *
 * Also importable: const { analyze } = require('./correlations');
 */

const fs = require('fs');
const { loadJSON } = require('./helpers');
const paths = require('./paths');

// ── Platform metric config ──
const PRIMARY_METRIC = {
  tiktok: 'views', instagram: 'views', facebook: 'engagement',
  twitter: 'impressions', linkedin: 'impressions', reddit: 'score',
};

function analyze(posts, metric) {
  // Filter to posts with actual metrics
  const measured = posts.filter(p => (p[metric] || 0) > 0 || p.engagementRate !== undefined);
  if (measured.length < 5) return { correlations: [], meta: { measuredPosts: measured.length, insufficient: true } };

  const avgMetric = measured.reduce((s, p) => s + (p[metric] || 0), 0) / measured.length;
  const avgEngagement = measured.reduce((s, p) => s + (p.engagementRate || 0), 0) / measured.length;

  const correlations = [];

  // ── 1. Format correlations ──
  const byFormat = {};
  for (const p of measured) {
    const fmt = p.format || 'unknown';
    if (!byFormat[fmt]) byFormat[fmt] = { posts: [], metric: [], engagement: [] };
    byFormat[fmt].posts.push(p);
    byFormat[fmt].metric.push(p[metric] || 0);
    byFormat[fmt].engagement.push(p.engagementRate || 0);
  }
  for (const [fmt, data] of Object.entries(byFormat)) {
    if (data.posts.length < 2) continue;
    const avg = data.metric.reduce((a, b) => a + b, 0) / data.metric.length;
    const avgEng = data.engagement.reduce((a, b) => a + b, 0) / data.engagement.length;
    const vs = avgMetric > 0 ? ((avg / avgMetric - 1) * 100).toFixed(0) : '0';
    correlations.push({
      pattern: `format:${fmt}`,
      posts: data.posts.length,
      [`avg_${metric}`]: Math.round(avg),
      avg_engagement_rate: +avgEng.toFixed(2),
      vs_avg: `${vs > 0 ? '+' : ''}${vs}%`,
      signal: avg > avgMetric * 1.2 ? 'strong' : avg < avgMetric * 0.5 ? 'weak' : 'neutral',
    });
  }

  // ── 2. Hook pattern correlations ──
  const hookPatterns = [
    { name: 'starts_with_pov', test: t => /^pov[:\s]/i.test(t) },
    { name: 'starts_with_i', test: t => /^i\s/i.test(t) },
    { name: 'starts_with_my', test: t => /^my\s/i.test(t) },
    { name: 'starts_with_why', test: t => /^why\s/i.test(t) },
    { name: 'starts_with_how', test: t => /^how\s/i.test(t) },
    { name: 'question_hook', test: t => t.includes('?') },
    { name: 'number_in_hook', test: t => /\d/.test(t) },
    { name: 'mentions_platforms', test: t => /platform|twitter|linkedin|tiktok|instagram|reddit/i.test(t) },
    { name: 'mentions_ai', test: t => /\bai\b|artificial intelligence|gpt|chatgpt|claude/i.test(t) },
    { name: 'mentions_time_pain', test: t => /hours|minutes|spent|wasted|copy.?past/i.test(t) },
    { name: 'mentions_launch', test: t => /launch|ship|deploy|release/i.test(t) },
    { name: 'cofounder_hook', test: t => /cofounder|co-founder/i.test(t) },
    { name: 'negative_emotion', test: t => /hate|frustrat|annoy|pain|struggle|suck|worst|terrible|scream|kill me/i.test(t) },
    { name: 'uses_emoji', test: t => /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(t) },
    { name: 'all_lowercase', test: t => t === t.toLowerCase() },
    { name: 'short_hook_under_50', test: t => t.length < 50 },
    { name: 'long_hook_over_100', test: t => t.length > 100 },
  ];

  for (const { name, test } of hookPatterns) {
    const matching = measured.filter(p => p.text && test(p.text));
    const notMatching = measured.filter(p => p.text && !test(p.text));
    if (matching.length < 2 || notMatching.length < 2) continue;

    const matchAvg = matching.reduce((s, p) => s + (p[metric] || 0), 0) / matching.length;
    const matchEng = matching.reduce((s, p) => s + (p.engagementRate || 0), 0) / matching.length;
    const noMatchAvg = notMatching.reduce((s, p) => s + (p[metric] || 0), 0) / notMatching.length;

    const ratio = noMatchAvg > 0 ? matchAvg / noMatchAvg : 0;
    // Only report if meaningful difference (>30% either direction)
    if (Math.abs(ratio - 1) < 0.3) continue;

    const vs = ((ratio - 1) * 100).toFixed(0);
    correlations.push({
      pattern: `hook:${name}`,
      posts_with: matching.length,
      posts_without: notMatching.length,
      [`avg_${metric}_with`]: Math.round(matchAvg),
      [`avg_${metric}_without`]: Math.round(noMatchAvg),
      avg_engagement_with: +matchEng.toFixed(2),
      vs_without: `${vs > 0 ? '+' : ''}${vs}%`,
      signal: ratio > 1.5 ? 'strong' : ratio < 0.5 ? 'weak' : ratio > 1.3 ? 'positive' : 'negative',
    });
  }

  // ── 3. Posting time correlations ──
  const byHour = {};
  for (const p of measured) {
    const h = p.hour || 'unknown';
    if (!byHour[h]) byHour[h] = { metric: [], engagement: [] };
    byHour[h].metric.push(p[metric] || 0);
    byHour[h].engagement.push(p.engagementRate || 0);
  }
  for (const [hour, data] of Object.entries(byHour)) {
    if (data.metric.length < 3) continue;
    const avg = data.metric.reduce((a, b) => a + b, 0) / data.metric.length;
    const avgEng = data.engagement.reduce((a, b) => a + b, 0) / data.engagement.length;
    const vs = avgMetric > 0 ? ((avg / avgMetric - 1) * 100).toFixed(0) : '0';
    if (Math.abs(+vs) < 20) continue; // Only report meaningful time differences
    correlations.push({
      pattern: `time:${hour}`,
      posts: data.metric.length,
      [`avg_${metric}`]: Math.round(avg),
      avg_engagement_rate: +avgEng.toFixed(2),
      vs_avg: `${vs > 0 ? '+' : ''}${vs}%`,
      signal: +vs > 30 ? 'strong' : +vs < -30 ? 'weak' : 'neutral',
    });
  }

  // ── 4. Slide count correlations (visual platforms) ──
  const bySlideCount = {};
  for (const p of measured) {
    const sc = (p.slideTexts || []).length;
    if (sc === 0) continue;
    if (!bySlideCount[sc]) bySlideCount[sc] = { metric: [], engagement: [] };
    bySlideCount[sc].metric.push(p[metric] || 0);
    bySlideCount[sc].engagement.push(p.engagementRate || 0);
  }
  for (const [count, data] of Object.entries(bySlideCount)) {
    if (data.metric.length < 3) continue;
    const avg = data.metric.reduce((a, b) => a + b, 0) / data.metric.length;
    const vs = avgMetric > 0 ? ((avg / avgMetric - 1) * 100).toFixed(0) : '0';
    if (Math.abs(+vs) < 20) continue;
    correlations.push({
      pattern: `slides:${count}`,
      posts: data.metric.length,
      [`avg_${metric}`]: Math.round(avg),
      vs_avg: `${vs > 0 ? '+' : ''}${vs}%`,
      signal: +vs > 30 ? 'strong' : +vs < -30 ? 'weak' : 'neutral',
    });
  }

  // ── 5. Caption length correlations ──
  const captionBuckets = { short: [], medium: [], long: [] };
  for (const p of measured) {
    const len = (p.caption || '').length;
    if (len === 0) continue;
    if (len < 100) captionBuckets.short.push(p);
    else if (len < 300) captionBuckets.medium.push(p);
    else captionBuckets.long.push(p);
  }
  for (const [bucket, bPosts] of Object.entries(captionBuckets)) {
    if (bPosts.length < 3) continue;
    const avg = bPosts.reduce((s, p) => s + (p[metric] || 0), 0) / bPosts.length;
    const vs = avgMetric > 0 ? ((avg / avgMetric - 1) * 100).toFixed(0) : '0';
    if (Math.abs(+vs) < 20) continue;
    correlations.push({
      pattern: `caption_length:${bucket}`,
      posts: bPosts.length,
      [`avg_${metric}`]: Math.round(avg),
      vs_avg: `${vs > 0 ? '+' : ''}${vs}%`,
      signal: +vs > 30 ? 'strong' : +vs < -30 ? 'weak' : 'neutral',
    });
  }

  // Sort by signal strength (strong/weak first)
  const signalOrder = { strong: 0, weak: 1, positive: 2, negative: 3, neutral: 4 };
  correlations.sort((a, b) => (signalOrder[a.signal] || 4) - (signalOrder[b.signal] || 4));

  return {
    correlations,
    meta: {
      measuredPosts: measured.length,
      totalPosts: posts.length,
      [`avg_${metric}`]: Math.round(avgMetric),
      avg_engagement_rate: +avgEngagement.toFixed(2),
    },
  };
}

// Export for use by self-improve-engine
module.exports = { analyze, PRIMARY_METRIC };

// ── CLI ──
if (require.main === module) {
  const { parseArgs } = require('./helpers');
  const { getArg } = parseArgs();
  const appName = getArg('app') || 'dropspace';
  const platform = getArg('platform');
  const jsonMode = process.argv.includes('--json');

  if (!platform) {
    console.error('Usage: node correlations.js --app <name> --platform <platform>');
    process.exit(1);
  }

  const postsFile = paths.postsPath(appName, platform);
  const data = loadJSON(postsFile, { posts: [] });
  const metric = PRIMARY_METRIC[platform] || 'views';
  const result = analyze(data.posts, metric);

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n📊 Correlations for ${appName}/${platform} (${result.meta.measuredPosts} posts with data)\n`);
    console.log(`Baseline: avg ${metric} = ${result.meta[`avg_${metric}`]}, avg engagement = ${result.meta.avg_engagement_rate}%\n`);
    for (const c of result.correlations) {
      const icon = c.signal === 'strong' ? '🟢' : c.signal === 'weak' ? '🔴' : c.signal === 'positive' ? '🟡' : c.signal === 'negative' ? '🟠' : '⚪';
      const detail = c.vs_avg ? `${c.vs_avg} vs avg` : c.vs_without ? `${c.vs_without} vs without` : '';
      console.log(`${icon} ${c.pattern} — ${c.posts || c.posts_with} posts — ${detail} [${c.signal}]`);
    }
  }
}
