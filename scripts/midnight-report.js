#!/usr/bin/env node
/**
 * midnight-report.js — Fresh daily report for midnight cron.
 * Uses the same data sources as self-improve (api.js).
 * 
 * Usage: node midnight-report.js --app dropspace [--days 7]
 * 
 * Outputs JSON report to stdout. Cron agent formats and delivers to Slack.
 */

const { supabaseSQL, stripeAPI, fetchPostHogReferrers, fetchGA4Traffic, fetchAttributionData, fetchSentryIssues, dropspaceRequest, fetchScheduledCounts, fetchCompletedCounts } = require('../core/api');
const path = require('path');
const fs = require('fs');

// ── Args ──
const { parseArgs, resolveApiKey } = require('../core/helpers');
const pathsLib = require('../core/paths');
const { getArg: _getArg } = parseArgs();
function getArg(name, def) {
  return _getArg(name) || def;
}

const days = parseInt(getArg('days', '7'));
const appName = getArg('app', 'dropspace');
const modeArg = getArg('mode', null); // null = auto-detect from app.json pipelineType
const appConfigPath = pathsLib.appConfigPath(appName);

async function main() {
  let appConfig;
  try {
    appConfig = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'));
  } catch (e) {
    console.error(`❌ Failed to parse ${appConfigPath}: ${e.message}`);
    process.exit(1);
  }
  // Mode: 'manual' skips heavy integrations (Supabase, PostHog, GA4, Stripe, Sentry, GitHub, Dropspace usage)
  // Auto-detects from pipelineType in app.json if --mode not specified
  const mode = modeArg || (appConfig.pipelineType === 'manual' ? 'manual' : 'full');
  const isManualMode = mode === 'manual';

  const report = {
    generated: new Date().toISOString(),
    app: appConfig.name || appName,
    days,
    mode,
  };

  const SUPABASE_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const POSTHOG_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
  const GH_TOKEN = process.env.GH_TOKEN;

  const supabaseProjectId = appConfig.integrations?.supabase?.projectId;
  const posthogProjectId = appConfig.integrations?.posthog?.projectId;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const todayCutoff = new Date();
  todayCutoff.setHours(0, 0, 0, 0);

  // ── 1. PostHog: Pageviews + Referrers + Daily Breakdown ──
  if (isManualMode) {
    report.posthog = { skipped: 'manual mode' };
  } else {
  // Single paginated fetch — reuse raw events for both referrer classification and daily breakdown
  console.error('📊 Fetching PostHog...');
  try {
    if (POSTHOG_KEY && posthogProjectId) {
      const phData = await fetchPostHogReferrers(POSTHOG_KEY, posthogProjectId, days);
      // Sort referrers by count descending for easy reading
      const sortedReferrers = Object.entries(phData.referrers || {})
        .sort(([,a], [,b]) => b - a)
        .reduce((o, [k, v]) => { o[k] = v; return o; }, {});
      report.posthog = {
        totalPageviews: phData.totalPageviews || 0,
        uniqueUsers: phData.uniqueUsers || 0,
        topSources: sortedReferrers,
        dailyPageviews: phData.dailyPageviews || {},
        days,
      };
    } else {
      report.posthog = { error: 'POSTHOG_PERSONAL_API_KEY or project ID not set' };
    }
  } catch (e) {
    report.posthog = { error: e.message };
  }

  } // end if (!isManualMode) PostHog

  // ── 1b. Client-side tracking health check ──
  if (isManualMode) {
    report.trackingHealth = { skipped: 'manual mode' };
  } else {
  console.error('🔍 Checking client-side tracking health...');
  try {
    if (POSTHOG_KEY && posthogProjectId) {
      const hogqlRes = await fetch(`https://us.posthog.com/api/projects/${posthogProjectId}/query/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${POSTHOG_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: {
            kind: 'HogQLQuery',
            query: `SELECT event, max(timestamp) as last_seen, count() as cnt 
                    FROM events 
                    WHERE timestamp > now() - interval 48 hour 
                      AND event IN ('$pageview', '$autocapture', '$web_vitals')
                    GROUP BY event`
          }
        }),
      });
      const hogqlData = await hogqlRes.json();
      const rows = hogqlData.results || [];
      
      const clientEvents = {};
      for (const [event, lastSeen, count] of rows) {
        clientEvents[event] = { lastSeen, count };
      }
      
      const pageviews = clientEvents['$pageview'];
      const hasRecentPageviews = pageviews && pageviews.count > 0;
      
      // Check if site is actually live
      let siteUp = false;
      try {
        const siteUrl = appConfig.url || null;
        if (!siteUrl) { siteUp = false; } else {
          const siteRes = await fetch(siteUrl, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
          siteUp = siteRes.ok;
        }
      } catch { siteUp = false; }
      
      if (!hasRecentPageviews && siteUp) {
        report.trackingHealth = {
          status: 'CRITICAL',
          message: 'Zero client-side pageviews in the last 48 hours while site is live (HTTP 200). PostHog client-side tracking is broken.',
          siteUp,
          clientEvents,
        };
      } else if (hasRecentPageviews) {
        report.trackingHealth = { status: 'OK', clientEvents };
      } else {
        report.trackingHealth = { status: 'UNKNOWN', siteUp, clientEvents };
      }
    }
  } catch (e) {
    report.trackingHealth = { status: 'ERROR', error: e.message };
  }

  } // end if (!isManualMode) tracking health

  // ── 1c. GA4 Traffic (runs for ALL apps that have ga4.propertyId configured) ──
  if (isManualMode && !appConfig.integrations?.ga4?.propertyId) {
    report.ga4 = { skipped: 'manual mode, no GA4 configured' };
  } else {
  console.error('📈 Fetching GA4 traffic...');
  try {
    const ga4PropertyId = appConfig.integrations?.ga4?.propertyId;
    if (!ga4PropertyId) throw new Error('No GA4 propertyId in app.json');
    const ga4Data = await fetchGA4Traffic(ga4PropertyId, days);
    report.ga4 = ga4Data;
    console.error(`   GA4: ${ga4Data.totalUsers} users, ${ga4Data.totalSessions} sessions, ${ga4Data.totalPageviews} pageviews`);
  } catch (e) {
    report.ga4 = { error: e.message };
    console.error(`   ⚠️ GA4 failed: ${e.message}`);
  }

  } // end if (!isManualMode) GA4

  // ── 2. User Attribution (Supabase + Stripe + PostHog) ──
  if (isManualMode) {
    report.users = { skipped: 'manual mode' };
    report.todaySignups = { skipped: 'manual mode' };
    report.stripe = { skipped: 'manual mode' };
    report.supabase = { skipped: 'manual mode' };
    report.github = { skipped: 'manual mode' };
    report.sentry = { skipped: 'manual mode' };
    report.dropspaceUsage = { skipped: 'manual mode' };
  } else {
  console.error('👤 Fetching attribution...');
  try {
    const { conversions, totalRevenue } = await fetchAttributionData(
      cutoff, appConfig, SUPABASE_TOKEN, supabaseProjectId, STRIPE_KEY
    );
    const statusCounts = {};
    const sourceCounts = {};
    for (const c of conversions) {
      statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
      sourceCounts[c.source] = (sourceCounts[c.source] || 0) + 1;
    }
    // Split automation-attributed vs manual signups
    const LINK_IN_BIO = ['tiktok', 'instagram'];
    const autoConv = conversions.filter(c =>
      c.utmCampaign === 'openclaw' || LINK_IN_BIO.includes(c.source)
    );
    const manualConv = conversions.filter(c =>
      c.utmCampaign !== 'openclaw' && !LINK_IN_BIO.includes(c.source)
    );
    const autoRevenue = autoConv.reduce((s, c) => s + (c.revenue || 0), 0);
    const manualRevenue = manualConv.reduce((s, c) => s + (c.revenue || 0), 0);

    report.users = {
      automationAttributed: {
        count: autoConv.length,
        revenue: autoRevenue,
        details: autoConv.map(c => ({
          email: c.email, status: c.status, source: c.source,
          utmCampaign: c.utmCampaign || null, revenue: c.revenue,
          signupTime: new Date(c.signupTime).toISOString(),
        })),
      },
      manualCampaigns: {
        count: manualConv.length,
        revenue: manualRevenue,
        note: 'These signups came from manual campaigns (bip, launch, etc.) — not automation',
        details: manualConv.map(c => ({
          email: c.email, status: c.status, source: c.source,
          utmCampaign: c.utmCampaign || null, revenue: c.revenue,
          signupTime: new Date(c.signupTime).toISOString(),
        })),
      },
      totalAllSources: conversions.length,
      totalRevenue,
      byStatus: statusCounts,
      bySource: sourceCounts,
    };
  } catch (e) {
    report.users = { error: e.message };
  }

  // ── 3. Today's signups specifically ──
  console.error('📝 Fetching today\'s signups...');
  try {
    const todayISO = todayCutoff.toISOString();
    const todayUsers = await supabaseSQL(
      `SELECT id, email, created_at FROM profiles WHERE created_at >= '${todayISO}' ORDER BY created_at ASC`,
      SUPABASE_TOKEN, supabaseProjectId
    );
    const customTestPatterns = (appConfig.integrations?.supabase?.testEmailPatterns || []).map(p => new RegExp(p, 'i'));
    const TEST_EMAIL_PATTERNS = [/system@/i, /test@/i, ...customTestPatterns];
    const real = (todayUsers || []).filter(u => u.email && !TEST_EMAIL_PATTERNS.some(p => p.test(u.email)));
    report.todaySignups = {
      count: real.length,
      users: real.map(u => ({ email: u.email, createdAt: u.created_at })),
    };
  } catch (e) {
    report.todaySignups = { error: e.message };
  }

  // ── 4. Stripe Revenue (last 30 days, app products only) ──
  // Only include Dropspace/Markus revenue. Never non-app revenue.
  console.error('💰 Fetching Stripe...');
  try {
    // Collect product IDs from ALL app configs (not just hardcoded apps)
    const appProductIds = new Set(appConfig.integrations?.stripe?.productIds || []);
    try {
      const appDirs = fs.readdirSync(pathsLib.DATA_ROOT, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name !== appName).map(d => d.name);
      for (const otherApp of appDirs) {
        const otherConfig = pathsLib.loadAppConfig(otherApp);
        for (const pid of (otherConfig?.integrations?.stripe?.productIds || [])) appProductIds.add(pid);
      }
    } catch { /* no other apps */ }

    const since30d = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);

    // Fetch subscriptions for known product IDs
    let appRevenue = 0;
    let appCharges = 0;
    const byProduct = {};

    if (appProductIds.size > 0 && STRIPE_KEY) {
      // Check active subscriptions
      const subs = await stripeAPI(`/subscriptions?status=all&limit=100&created[gte]=${since30d}`, STRIPE_KEY);
      if (subs?.data) {
        for (const sub of subs.data) {
          const subProducts = sub.items?.data?.map(i => i.price?.product) || [];
          if (!subProducts.some(p => appProductIds.has(p))) continue;
          // Get paid invoices for this subscription
          const invoices = await stripeAPI(`/invoices?subscription=${sub.id}&status=paid&limit=10`, STRIPE_KEY);
          if (invoices?.data) {
            for (const inv of invoices.data) {
              if (inv.created >= since30d) {
                appRevenue += inv.amount_paid / 100;
                appCharges++;
                const prodName = subProducts.find(p => appProductIds.has(p)) || 'unknown';
                if (!byProduct[prodName]) byProduct[prodName] = { count: 0, revenue: 0 };
                byProduct[prodName].count++;
                byProduct[prodName].revenue += inv.amount_paid / 100;
              }
            }
          }
        }
      }
    }

    report.stripe = {
      last30d: {
        totalCharges: appCharges,
        totalRevenue: appRevenue,
        byProduct,
        note: 'App revenue only (Dropspace + Markus). Excludes non-app revenue',
      },
    };
  } catch (e) {
    report.stripe = { error: e.message };
  }

  // ── 5. Supabase Health ──
  console.error('🗄️ Checking Supabase health...');
  try {
    // Discover Supabase projects from all app configs
    const appDirs = fs.readdirSync(pathsLib.DATA_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
    const supabaseProjects = {};
    for (const app of appDirs) {
      const cfg = pathsLib.loadAppConfig(app);
      const pid = cfg?.integrations?.supabase?.projectId;
      if (pid) supabaseProjects[app] = pid;
    }

    report.supabase = {};
    for (const [name, projectId] of Object.entries(supabaseProjects)) {
      const res = await fetch(`https://api.supabase.com/v1/projects/${projectId}`, {
        headers: { 'Authorization': `Bearer ${SUPABASE_TOKEN}` },
      });
      if (res.ok) {
        const data = await res.json();
        report.supabase[name] = { status: data.status || 'unknown' };
      } else {
        report.supabase[name] = { status: 'fetch_error', code: res.status };
      }
    }
  } catch (e) {
    report.supabase = { error: e.message };
  }

  // ── 6. GitHub Activity (last 24h) ──
  console.error('🐙 Checking GitHub...');
  try {
    const ghConfig = appConfig.integrations?.github;
    const ghOrg = ghConfig?.org;
    if (!ghOrg) { report.github = { error: 'GitHub org not configured' }; } else {
    const repos = ghConfig?.repo ? [ghConfig.repo] : (ghConfig?.repos || []);
    report.github = {};
    for (const repo of repos) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const commitsRes = await fetch(`https://api.github.com/repos/${ghOrg}/${repo}/commits?since=${since}&per_page=20`, {
        headers: { 'Authorization': `Bearer ${GH_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
      });
      const commits = commitsRes.ok ? await commitsRes.json() : [];

      const prsRes = await fetch(`https://api.github.com/repos/${ghOrg}/${repo}/pulls?state=open&per_page=10`, {
        headers: { 'Authorization': `Bearer ${GH_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
      });
      const prs = prsRes.ok ? await prsRes.json() : [];

      report.github[repo] = {
        commitsLast24h: Array.isArray(commits) ? commits.length : 0,
        openPRs: Array.isArray(prs) ? prs.length : 0,
        prTitles: Array.isArray(prs) ? prs.map(p => p.title) : [],
      };
    }
    } // end ghOrg else
  } catch (e) {
    report.github = { error: e.message };
  }

  // ── 7. Sentry Issues (unresolved + recent only) ──
  console.error('🐛 Checking Sentry...');
  try {
    const SENTRY_TOKEN = process.env.SENTRY_ACCESS_TOKEN;
    if (SENTRY_TOKEN) {
      report.sentry = {};
      const sentryConfig = appConfig.integrations?.sentry;
      const sentryOrg = sentryConfig?.org;
      if (!sentryOrg) { report.sentry = { error: 'Sentry org not configured' }; } else {
      const sentryProjects = sentryConfig?.project ? [sentryConfig.project] : (sentryConfig?.projects || []);
      for (const project of sentryProjects) {
        const { issues, error } = await fetchSentryIssues(project, {
          maxAgeHours: 48,
          limit: 15,
          org: sentryOrg,
        });
        if (error) {
          report.sentry[project] = { error };
        } else {
          report.sentry[project] = {
            activeIssues: issues.length,
            issues: issues.map(i => ({
              id: i.id,
              title: i.title,
              count: i.count,
              level: i.level,
              lastSeen: i.lastSeen,
            })),
          };
        }
      }
      } // end sentryOrg else
    } else {
      report.sentry = { error: 'SENTRY_ACCESS_TOKEN not set' };
    }
  } catch (e) {
    report.sentry = { error: e.message };
  }
  } // end if (!isManualMode) — sections 2-7

  // ── 8. Post Deletions (last 7 days) ──
  console.error('🗑️ Checking for deleted posts...');
  try {
    const DROPSPACE_KEY = resolveApiKey(appName);
    if (DROPSPACE_KEY) {
      const { dropspaceRequest } = require('../core/api');
      const appConfig = pathsLib.loadAppConfig(appName);
      const platforms = appConfig
        ? Object.entries(appConfig.platforms).filter(([_, c]) => c.enabled !== false).map(([n]) => n)
        : ['tiktok', 'instagram', 'facebook', 'twitter', 'linkedin', 'reddit'];

      const deletedPosts = [];
      const deletionCutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      // Scan posts.json for each platform for recently deleted posts (within report window)
      for (const p of platforms) {
        const postsFile = pathsLib.postsPath(appName, p);
        try {
          const data = JSON.parse(fs.readFileSync(postsFile, 'utf-8'));
          const deleted = (data.posts || []).filter(post => {
            if (!post.isDeleted) return false;
            // Only include deletions detected within the report window
            const detectedAt = post.deletedDetectedAt || post.date || '';
            return detectedAt >= deletionCutoff;
          });
          for (const d of deleted) {
            deletedPosts.push({
              platform: p,
              text: d.text,
              deletionReason: d.deletionReason || 'unknown',
              deletedDetectedAt: d.deletedDetectedAt || null,
              date: d.date,
            });
          }
        } catch { /* no posts.json for this platform */ }
      }

      // Also find unposted drafts (scheduled but never got a postUrl) within report window
      const unpostedPosts = [];
      for (const p of platforms) {
        const postsFile = pathsLib.postsPath(appName, p);
        try {
          const data = JSON.parse(fs.readFileSync(postsFile, 'utf-8'));
          const unposted = (data.posts || []).filter(post => {
            if (post.isDeleted) return false; // already counted above
            if (post.postUrl || post.launchId) return false; // submitted to Dropspace (postUrl may not be backfilled yet)
            if (!post.date) return false;
            return post.date >= deletionCutoff;
          });
          for (const u of unposted) {
            unpostedPosts.push({
              platform: p,
              text: u.text,
              date: u.date,
            });
          }
        } catch { /* no posts.json for this platform */ }
      }

      if (deletedPosts.length > 0) {
        const byReason = {};
        const byPlatform = {};
        for (const d of deletedPosts) {
          byReason[d.deletionReason] = (byReason[d.deletionReason] || 0) + 1;
          byPlatform[d.platform] = (byPlatform[d.platform] || 0) + 1;
        }
        report.deletedPosts = {
          total: deletedPosts.length,
          byReason,
          byPlatform,
          details: deletedPosts.map(d => ({
            platform: d.platform,
            text: (d.text || '').substring(0, 80),
            reason: d.deletionReason,
            detectedAt: d.deletedDetectedAt,
            postDate: d.date,
          })),
        };
      } else {
        report.deletedPosts = { total: 0, note: 'No deleted posts detected' };
      }

      if (unpostedPosts.length > 0) {
        const byPlatform = {};
        for (const u of unpostedPosts) {
          byPlatform[u.platform] = (byPlatform[u.platform] || 0) + 1;
        }
        report.unpostedDrafts = {
          total: unpostedPosts.length,
          byPlatform,
          details: unpostedPosts.map(u => ({
            platform: u.platform,
            text: (u.text || '').substring(0, 80),
            postDate: u.date,
          })),
        };
      } else {
        report.unpostedDrafts = { total: 0 };
      }
    } else {
      report.deletedPosts = { error: 'DROPSPACE_API_KEY not set (check apiKeyEnv in app.json)' };
    }
  } catch (e) {
    report.deletedPosts = { error: e.message };
  }

  // ── 9. Posting Pipeline Status ──  
  console.error('📮 Checking posting pipeline...');
  try {
    const appConfig = pathsLib.loadAppConfig(appName);
    const isManual = appConfig?.pipelineType === 'manual';
    const platforms = appConfig
      ? Object.entries(appConfig.platforms).filter(([_, c]) => c.enabled !== false).map(([n]) => n)
      : ['tiktok', 'instagram', 'facebook', 'twitter', 'linkedin', 'reddit'];

    // For manual apps, get queue depth from Dropspace scheduled launches
    let scheduledCounts = {};
    let completedStats = { total: 0, byPlatform: {} };
    try {
      const apiKey = resolveApiKey(appName);
      if (apiKey) {
        if (isManual) scheduledCounts = await fetchScheduledCounts(apiKey);
        completedStats = await fetchCompletedCounts(apiKey, days);
      }
    } catch { /* fallback to local */ }

    report.pipeline = {};
    for (const p of platforms) {
      const platConfig = appConfig?.platforms?.[p] || {};
      let platType = 'text';
      try { const { getPlatformDef } = require('../core/platforms'); platType = getPlatformDef(p)?.type || 'text'; } catch {}

      // Queue depth: Dropspace scheduled count for manual, local postQueue for ai-generated
      let queueDepth = 0;
      if (isManual && scheduledCounts[p] !== undefined) {
        queueDepth = scheduledCounts[p];
      } else {
        const stratPath = pathsLib.strategyPath(appName, p);
        if (fs.existsSync(stratPath)) {
          try {
            const strat = JSON.parse(fs.readFileSync(stratPath, 'utf8'));
            queueDepth = (strat.postQueue || []).length;
          } catch {}
        }
      }

      report.pipeline[p] = {
        type: platType,
        hooksInQueue: queueDepth,
        postingTimes: platConfig.postingTimes || [],
      };
    }
    report.completedPosts = completedStats;
  } catch (e) {
    report.pipeline = { error: e.message };
  }

  // ── 10. Dropspace API Usage/Limits (full mode only) ──
  if (isManualMode) {
    // Already set above in the bulk skip
  } else {
  console.error('📦 Checking Dropspace usage...');
  try {
    const DROPSPACE_KEY = resolveApiKey(appName);
    if (DROPSPACE_KEY) {
      const { dropspaceRequest } = require('../core/api');
      const usage = await dropspaceRequest('GET', '/usage', null, DROPSPACE_KEY);
      if (usage?.data) {
        report.dropspaceUsage = {
          plan: usage.data.plan,
          billingPeriod: usage.data.billing_period,
          limits: usage.data.limits,
          features: usage.data.features,
        };
      }
    } else {
      report.dropspaceUsage = { error: 'DROPSPACE_API_KEY not set (check apiKeyEnv in app.json)' };
    }
  } catch (e) {
    report.dropspaceUsage = { error: e.message };
  }
  } // end if (!isManualMode) Dropspace usage

  // Output
  console.log(JSON.stringify(report, null, 2));

  // ── Slack Delivery ──
  const { sendAppReport } = require('../core/helpers');
  const slackLines = [`_🌙 Midnight Report — ${appName} — ${new Date().toISOString().split('T')[0]} (${days}d window)_`];

  // PostHog
  if (report.posthog) {
    const ph = report.posthog;
    slackLines.push(`\n*PostHog:* ${ph.uniqueUsers || 0} users · ${ph.totalPageviews || 0} pageviews`);
    if (ph.topSources?.length) {
      slackLines.push(`Top: ${ph.topSources.slice(0, 5).map(s => `${s.source} (${s.count})`).join(', ')}`);
    }
  }

  // GA4
  if (report.ga4) {
    const g = report.ga4;
    slackLines.push(`\n*GA4:* ${g.users || 0} users · ${g.sessions || 0} sessions · ${g.pageviews || 0} pageviews`);
    if (g.topSources?.length) {
      slackLines.push(`Top: ${g.topSources.slice(0, 5).map(s => `${s.source} (${s.users} users)`).join(', ')}`);
    }
  }

  // Signups
  if (report.todaySignups?.total) {
    slackLines.push(`\n*Signups (today):* ${report.todaySignups.total}`);
  }

  // Stripe
  if (report.stripe) {
    slackLines.push(`\n*Stripe (30d):* ${report.stripe.totalCharges || 0} charges · $${((report.stripe.totalRevenue || 0) / 100).toFixed(0)} revenue`);
  }

  // Pipeline queues
  if (report.pipeline && typeof report.pipeline === 'object' && !report.pipeline.error) {
    const qLines = Object.entries(report.pipeline).map(([p, v]) => `${p}: ${v.hooksInQueue ?? '?'}`).join(' · ');
    slackLines.push(`\n*Queues:* ${qLines}`);
  }

  // Completed posts
  if (report.completedPosts) {
    const cp = report.completedPosts;
    const total = Object.values(cp).reduce((a, b) => a + b, 0);
    const cpLines = Object.entries(cp).map(([p, c]) => `${p} ${c}`).join(' · ');
    slackLines.push(`\n*Posts (${days}d):* ${total} total — ${cpLines}`);
  }

  // Health
  if (report.trackingHealth?.status) {
    const icon = report.trackingHealth.status === 'CRITICAL' ? '🔴' : '✅';
    slackLines.push(`\n*Health:* ${icon} ${report.trackingHealth.status}`);
  }

  try {
    await sendAppReport(appName, slackLines.join('\n'));
  } catch (e) {
    console.error(`⚠️ Slack report failed: ${e.message}`);
  }
}

main().catch(e => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
