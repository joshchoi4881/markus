#!/usr/bin/env node
/**
 * Refresh CONTEXT.md for text-content apps — pulls live data from external sources.
 *
 * Usage:
 *   node refresh-context.js --app <APP> --project dropspace
 *
 * Reads app.json integrations config to determine which sources to pull from.
 * Currently supports: GitHub, Supabase, PostHog, Stripe, Sentry, GA4, Dropspace API.
 *
 * Writes to: ~/dropspace/apps/<app>/config/<project>/CONTEXT.md
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}

const appName = getArg('app', null);
const project = getArg('project', null);

if (!appName || !project) {
  console.error('Usage: node refresh-context.js --app <name> --project <project>');
  process.exit(1);
}

const HOME = process.env.HOME;
const pathsLib = require('../core/paths');
const appConfig = JSON.parse(fs.readFileSync(pathsLib.appConfigPath(appName), 'utf-8'));
const integrations = appConfig.integrations || {};

// ── Data fetchers ──

async function fetchGitHub() {
  const gh = integrations.github;
  if (!gh) return null;

  const token = process.env.GH_TOKEN;
  if (!token) { console.error('  ⚠️ GH_TOKEN not set, skipping GitHub'); return null; }

  const headers = { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' };
  const results = {};

  for (const repo of (gh.repos || [gh.repo]).filter(Boolean)) {
    const repoPath = `${gh.org}/${repo}`;
    try {
      const repoData = await fetch(`https://api.github.com/repos/${repoPath}`, { headers }).then(r => r.json());

      // Get commit count
      const contribs = await fetch(`https://api.github.com/repos/${repoPath}/contributors?per_page=1`, { headers }).then(r => r.json());
      const totalCommits = Array.isArray(contribs) ? contribs.reduce((s, c) => s + (c.contributions || 0), 0) : 0;

      // Recent commits (last 7 days)
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const recentCommits = await fetch(`https://api.github.com/repos/${repoPath}/commits?since=${since}&per_page=100`, { headers }).then(r => r.json());

      // Open issues
      const issues = await fetch(`https://api.github.com/repos/${repoPath}/issues?state=open&per_page=100`, { headers }).then(r => r.json());
      const openIssues = Array.isArray(issues) ? issues.filter(i => !i.pull_request).length : 0;

      // Open PRs
      const openPRs = Array.isArray(issues) ? issues.filter(i => i.pull_request).length : 0;

      results[repo] = {
        totalCommits,
        recentCommits: Array.isArray(recentCommits) ? recentCommits.length : 0,
        openIssues,
        openPRs,
        stars: repoData.stargazers_count || 0,
        language: repoData.language || 'unknown',
      };
    } catch (e) {
      console.error(`  ⚠️ GitHub ${repoPath}: ${e.message}`);
    }
  }

  return Object.keys(results).length > 0 ? results : null;
}

async function fetchSupabase() {
  const sb = integrations.supabase;
  if (!sb?.projectId) return null;

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) { console.error('  ⚠️ SUPABASE_ACCESS_TOKEN not set, skipping Supabase'); return null; }

  try {
    // Use mcporter to run SQL
    const sql = `SELECT 
      (SELECT count(*) FROM profiles) as total_users,
      (SELECT count(*) FROM profiles WHERE created_at > now() - interval '30 days') as users_30d,
      (SELECT count(*) FROM profiles WHERE created_at > now() - interval '7 days') as users_7d,
      (SELECT count(*) FROM portal_launches) as total_launches,
      (SELECT count(*) FROM portal_launches WHERE status = 'completed') as completed_launches,
      (SELECT count(*) FROM posting_logs WHERE status = 'success') as successful_posts,
      (SELECT count(*) FROM posting_logs WHERE status = 'failed') as failed_posts,
      (SELECT count(*) FROM personas) as personas,
      (SELECT count(*) FROM api_keys WHERE is_active = true) as active_api_keys`;

    const result = execSync(
      `mcporter call 'supabase.execute_sql(project_id="${sb.projectId}", query="${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}")'`,
      { encoding: 'utf-8', timeout: 30000 }
    );

    return JSON.parse(result);
  } catch (e) {
    console.error(`  ⚠️ Supabase: ${e.message}`);
    return null;
  }
}

async function fetchGA4() {
  const ga4 = integrations.ga4;
  if (!ga4?.propertyId) return null;

  try {
    const result = execSync(
      `mcporter call 'ga4.run_report(property="properties/${ga4.propertyId}", date_ranges=[{"startDate":"30daysAgo","endDate":"today"}], metrics=[{"name":"screenPageViews"},{"name":"totalUsers"},{"name":"sessions"}], dimensions=[{"name":"date"}])'`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    const data = JSON.parse(result);
    const rows = data.rows || [];
    const totals = rows.reduce((acc, r) => {
      acc.pageviews += parseInt(r.metricValues?.[0]?.value || 0);
      acc.users += parseInt(r.metricValues?.[1]?.value || 0);
      acc.sessions += parseInt(r.metricValues?.[2]?.value || 0);
      return acc;
    }, { pageviews: 0, users: 0, sessions: 0 });

    return { last30d: totals, dailyRows: rows.length };
  } catch (e) {
    console.error(`  ⚠️ GA4: ${e.message}`);
    return null;
  }
}

async function fetchStripe() {
  const stripe = integrations.stripe;
  if (!stripe) return null;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { console.error('  ⚠️ STRIPE_SECRET_KEY not set, skipping Stripe'); return null; }

  try {
    // Get recent charges
    const charges = await fetch('https://api.stripe.com/v1/charges?limit=100', {
      headers: { 'Authorization': `Basic ${Buffer.from(key + ':').toString('base64')}` },
    }).then(r => r.json());

    const totalRevenue = (charges.data || [])
      .filter(c => c.paid && !c.refunded)
      .reduce((s, c) => s + c.amount, 0) / 100;

    // Get subscriptions
    const subs = await fetch('https://api.stripe.com/v1/subscriptions?limit=100', {
      headers: { 'Authorization': `Basic ${Buffer.from(key + ':').toString('base64')}` },
    }).then(r => r.json());

    const activeSubs = (subs.data || []).filter(s => s.status === 'active').length;

    return { totalRevenue, activeSubs, totalCharges: (charges.data || []).length };
  } catch (e) {
    console.error(`  ⚠️ Stripe: ${e.message}`);
    return null;
  }
}

async function fetchDropspaceAPI() {
  const apiKey = process.env[appConfig.apiKeyEnv];
  if (!apiKey) return null;

  try {
    const launches = await fetch('https://api.dropspace.dev/launches?limit=1', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    }).then(r => r.json());

    const connections = await fetch('https://api.dropspace.dev/connections', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    }).then(r => r.json());

    return {
      totalLaunches: launches.pagination?.total || 0,
      activeConnections: (connections.data || []).filter(c => c.is_active).length,
    };
  } catch (e) {
    console.error(`  ⚠️ Dropspace API: ${e.message}`);
    return null;
  }
}

// ── Build CONTEXT.md ──

async function main() {
  console.error(`🔄 Refreshing CONTEXT.md for ${appName}/${project}...\n`);

  const [github, supabase, ga4, stripe, dropspace] = await Promise.all([
    fetchGitHub(),
    fetchSupabase(),
    fetchGA4(),
    fetchStripe(),
    fetchDropspaceAPI(),
  ]);

  const now = new Date().toISOString().slice(0, 19);

  let md = `# ${project.charAt(0).toUpperCase() + project.slice(1)} — Context Data\n\n`;
  md += `*Auto-generated by refresh-context.js — ${now} UTC*\n\n`;
  md += `## The Numbers\n\n`;
  md += `| Metric | Value | Source |\n|--------|-------|--------|\n`;

  // GitHub
  if (github) {
    for (const [repo, data] of Object.entries(github)) {
      md += `| ${repo} commits | ${data.totalCommits.toLocaleString()} | GitHub |\n`;
      md += `| ${repo} commits (7d) | ${data.recentCommits} | GitHub |\n`;
      md += `| ${repo} open issues | ${data.openIssues} | GitHub |\n`;
      md += `| ${repo} open PRs | ${data.openPRs} | GitHub |\n`;
    }
  }

  // Supabase
  if (supabase) {
    const rows = supabase.result?.[0] || supabase[0] || {};
    if (rows.total_users !== undefined) md += `| Total users | ${rows.total_users} | Supabase |\n`;
    if (rows.users_30d !== undefined) md += `| Users (30d) | ${rows.users_30d} | Supabase |\n`;
    if (rows.users_7d !== undefined) md += `| Users (7d) | ${rows.users_7d} | Supabase |\n`;
    if (rows.total_launches !== undefined) md += `| Total launches | ${rows.total_launches} | Supabase |\n`;
    if (rows.completed_launches !== undefined) md += `| Completed launches | ${rows.completed_launches} | Supabase |\n`;
    if (rows.successful_posts !== undefined) md += `| Successful posts | ${rows.successful_posts} | Supabase |\n`;
    if (rows.personas !== undefined) md += `| Personas | ${rows.personas} | Supabase |\n`;
    if (rows.active_api_keys !== undefined) md += `| Active API keys | ${rows.active_api_keys} | Supabase |\n`;
  }

  // GA4
  if (ga4) {
    md += `| Pageviews (30d) | ${ga4.last30d.pageviews.toLocaleString()} | GA4 |\n`;
    md += `| Unique users (30d) | ${ga4.last30d.users.toLocaleString()} | GA4 |\n`;
    md += `| Sessions (30d) | ${ga4.last30d.sessions.toLocaleString()} | GA4 |\n`;
  }

  // Stripe
  if (stripe) {
    md += `| MRR | $${stripe.totalRevenue.toFixed(2)} | Stripe |\n`;
    md += `| Active subscriptions | ${stripe.activeSubs} | Stripe |\n`;
    md += `| Total charges | ${stripe.totalCharges} | Stripe |\n`;
  }

  // Dropspace
  if (dropspace) {
    md += `| Dropspace launches | ${dropspace.totalLaunches} | Dropspace API |\n`;
    md += `| Active connections | ${dropspace.activeConnections} | Dropspace API |\n`;
  }

  md += '\n';

  // Preserve any manual sections from existing CONTEXT.md
  const outDir = path.join(HOME, 'dropspace', 'apps', appName, 'config', project);
  const outPath = path.join(outDir, 'CONTEXT.md');

  if (fs.existsSync(outPath)) {
    const existing = fs.readFileSync(outPath, 'utf-8');
    // Find manual sections (anything after "## Manual Notes" or "## Build Timeline" etc.)
    const manualMarkers = ['## Build Timeline', '## Key Technical Decisions', '## Hardest Bugs', '## Manual Notes', '## Notes'];
    for (const marker of manualMarkers) {
      const idx = existing.indexOf(marker);
      if (idx > 0) {
        md += '\n' + existing.slice(idx);
        break;
      }
    }
  }

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, md);
  console.error(`\n✅ Written to ${outPath}`);
}

main().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
