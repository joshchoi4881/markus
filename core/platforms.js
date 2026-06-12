/**
 * Platform configuration registry.
 *
 * Replaces 28 per-platform wrapper scripts. Each platform defines:
 *   - type: 'visual' | 'text'
 *   - Self-improve config (primaryMetric, extractMetrics, engagementFormula, reportExtras)
 *   - Create-post config (validation, content building, platform_contents)
 *   - Post metric fields (what gets tracked in posts.json)
 *
 * Engines import this and look up config by platform name.
 */

// ── Shared emoji regex for Twitter validation ──
const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}-\u{26AB}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F3}\u{26F5}\u{26FA}\u{26FD}\u{2702}\u{2705}\u{2708}-\u{270D}\u{270F}]/gu;

const PLATFORMS = {

  // ═══════════════════════════════════════════════
  // VISUAL PLATFORMS (image carousel + text overlay)
  // ═══════════════════════════════════════════════

  tiktok: {
    type: 'visual',
    defaultPlatforms: ['tiktok'],
    tiktokPrivacyLevel: 'SELF_ONLY',
    minMedia: 2,
    ctaCopy: 'try it → link in bio',

    // Self-improve
    primaryMetric: 'views',
    extractMetrics: (platformData) => {
      const m = platformData?.metrics || {};
      const views = m.views || 0;
      const likes = m.likes || 0;
      const comments = m.comments || 0;
      const shares = m.shares || 0;
      const engagementRate = views > 0 ? ((likes + comments + shares) / views * 100) : 0;
      return { views, likes, comments, shares, engagementRate: Math.round(engagementRate * 100) / 100 };
    },
    engagementFormula: (post) => {
      const views = post.views || 0;
      const interactions = (post.likes || 0) + (post.comments || 0) + (post.shares || 0);
      return views > 0 ? Math.round(interactions / views * 10000) / 100 : 0; // percentage
    },

    reportExtras: (data) => {
      const { postData } = data;
      if (!postData.length) return ['- No engagement data yet'];
      const totalViews = postData.reduce((s, p) => s + (p.views || 0), 0);
      const totalLikes = postData.reduce((s, p) => s + (p.likes || 0), 0);
      const totalComments = postData.reduce((s, p) => s + (p.comments || 0), 0);
      const totalShares = postData.reduce((s, p) => s + (p.shares || 0), 0);
      const engRate = totalViews > 0 ? ((totalLikes + totalComments + totalShares) / totalViews * 100).toFixed(2) : '0.00';
      return [
        '## TikTok Engagement',
        `- Engagement rate: ${engRate}%`,
        `- Total: ${totalLikes} likes, ${totalComments} comments, ${totalShares} shares`,
        `- Total views: ${totalViews}`,
      ];
    },

    // Post tracking
    postMetricFields: () => ({
      views: 0, likes: 0, comments: 0, shares: 0, engagementRate: 0,
    }),

    draftMessage: (launchId, hook, caption) => [
      `\n📋 DRAFT MODE — Post ready for manual publishing`,
      `Launch ID: ${launchId}`,
      `Hook: "${hook}"`,
      `Caption (copy this):\n---\n${caption || hook}\n---`,
      `Next steps:`,
      `1. Open TikTok → search for trending sounds in your niche`,
      `2. Go to Dropspace dashboard or publish via API when ready`,
      `3. Add trending music before publishing for maximum reach`,
    ].join('\n'),
  },

  instagram: {
    type: 'visual',
    defaultPlatforms: ['instagram'],
    minMedia: 2, // Instagram carousel requires ≥ 2 images
    ctaCopy: 'link in bio',

    primaryMetric: 'views',
    extractMetrics: (platformData) => {
      const m = platformData?.metrics || {};
      const views = m.views || 0;
      const likes = m.likes || 0;
      const comments = m.comments || 0;
      const shares = m.shares || 0;
      const saved = m.saved || 0;
      const engagement = m.engagement || 0;
      const engagementRate = views > 0 ? ((likes + comments + shares + saved) / views * 100) : 0;
      return { views, likes, comments, shares, saved, engagement, engagementRate: Math.round(engagementRate * 100) / 100 };
    },
    engagementFormula: (post) => {
      const views = post.views || 0;
      const interactions = (post.likes || 0) + (post.comments || 0) + (post.shares || 0) + (post.saved || 0);
      return views > 0 ? Math.round(interactions / views * 10000) / 100 : 0;
    },

    reportExtras: (data) => {
      const { postData } = data;
      if (!postData.length) return ['- No engagement data yet'];
      const totalViews = postData.reduce((s, p) => s + (p.views || 0), 0);
      const totalLikes = postData.reduce((s, p) => s + (p.likes || 0), 0);
      const totalComments = postData.reduce((s, p) => s + (p.comments || 0), 0);
      const totalShares = postData.reduce((s, p) => s + (p.shares || 0), 0);
      const totalSaved = postData.reduce((s, p) => s + (p.saved || 0), 0);
      const engRate = totalViews > 0 ? ((totalLikes + totalComments + totalShares + totalSaved) / totalViews * 100).toFixed(2) : '0.00';
      return [
        '## Instagram Engagement',
        `- Engagement rate: ${engRate}%`,
        `- Total: ${totalLikes} likes, ${totalComments} comments, ${totalShares} shares, ${totalSaved} saved`,
        `- Total views: ${totalViews}`,
      ];
    },

    postMetricFields: () => ({
      views: 0, likes: 0, comments: 0, shares: 0, saved: 0, engagement: 0, engagementRate: 0,
    }),

    draftMessage: (launchId, hook, caption) => [
      `\n📋 DRAFT MODE — Post ready for manual publishing`,
      `Launch ID: ${launchId}`,
      `Hook: "${hook}"`,
      `Caption (copy this):\n---\n${caption || hook}\n---`,
      `Next steps:`,
      `1. Go to Dropspace dashboard or publish via API when ready`,
      `2. Review carousel images and caption before publishing`,
      `3. Ensure hashtags are included in caption for reach`,
    ].join('\n'),
  },

  facebook: {
    type: 'text',
    supportedTypes: ['text', 'visual'],
    defaultPlatforms: ['facebook'],
    minMedia: 2,
    ctaCopy: 'try it free →',

    primaryMetric: 'engagement',
    // Facebook doesn't return impressions/views — engagement is a weighted score, not a rate.
    // Formula: reactions + comments×2 + shares×3 (comments and shares weighted higher as stronger signals)
    engagementFormula: (post) => (post.reactions || 0) + ((post.comments || 0) * 2) + ((post.shares || 0) * 3),
    engagementIsScore: true, // Flag: this returns an absolute score, not a percentage
    extractMetrics: (platformData) => {
      const raw = platformData?.metrics || {};
      const toNum = (v) => typeof v === 'object' && v !== null ? (v.total || 0) : (v || 0);
      const reactions = toNum(raw.reactions);
      const comments = toNum(raw.comments);
      const shares = toNum(raw.shares);
      return { reactions, comments, shares };
    },

    postMetricFields: () => ({
      reactions: 0, comments: 0, shares: 0,
    }),

    buildPlatformContents: (hook, body) => ({
      facebook: { content: body },
    }),

    validate: (hook, body) => {
      const errors = [];
      const warnings = [];
      if (body.length > 5000) errors.push(`Content too long (${body.length} chars, max 5000 for Facebook)`);
      return { errors, warnings };
    },

    draftMessage: (launchId, hook, caption) => [
      `\n📋 DRAFT MODE — Post ready for manual publishing`,
      `Launch ID: ${launchId}`,
      `Hook: "${hook}"`,
      `Caption (copy this):\n---\n${caption || hook}\n---`,
      `Next steps:`,
      `1. Review post in Dropspace dashboard`,
      `2. Publish via dashboard or API when ready`,
    ].join('\n'),
  },

  // ═══════════════════════════════════════════════
  // TEXT PLATFORMS
  // ═══════════════════════════════════════════════

  twitter: {
    type: 'text',
    defaultPlatforms: ['twitter'],
    ctaCopy: 'try it →',

    primaryMetric: 'impressions',
    extractMetrics: (platformData) => {
      const m = platformData?.metrics || {};
      const impressions = m.impressions || 0;
      const likes = m.likes || 0;
      const retweets = m.retweets || 0;
      const replies = m.replies || 0; // Dropspace server-side already subtracts thread self-replies
      const quotes = m.quotes || 0;
      const bookmarks = m.bookmarks || 0;
      const urlClicks = m.urlClicks || 0;
      const profileClicks = m.profileClicks || 0;
      const isThread = m.isThread || false;
      const threadLength = m.threadLength || 1;
      const engagementRate = impressions > 0 ? ((likes + retweets + replies + quotes + bookmarks) / impressions * 100) : 0;
      return {
        impressions, likes, retweets, replies, quotes, bookmarks,
        urlClicks, profileClicks, isThread, threadLength,
        engagementRate: Math.round(engagementRate * 100) / 100,
      };
    },
    engagementFormula: (post) => {
      const impressions = post.impressions || 0;
      const interactions = (post.likes || 0) + (post.retweets || 0) + (post.replies || 0) + (post.quotes || 0) + (post.bookmarks || 0);
      return impressions > 0 ? Math.round(interactions / impressions * 10000) / 100 : 0;
    },
    reportExtras: (data) => {
      const { postData } = data;
      if (!postData.length) return ['- No engagement data yet'];
      const totalImpressions = postData.reduce((s, p) => s + (p.impressions || 0), 0);
      const totalLikes = postData.reduce((s, p) => s + (p.likes || 0), 0);
      const totalRTs = postData.reduce((s, p) => s + (p.retweets || 0), 0);
      const totalReplies = postData.reduce((s, p) => s + (p.replies || 0), 0);
      const totalQuotes = postData.reduce((s, p) => s + (p.quotes || 0), 0);
      const totalBookmarks = postData.reduce((s, p) => s + (p.bookmarks || 0), 0);
      const totalUrlClicks = postData.reduce((s, p) => s + (p.urlClicks || 0), 0);
      const totalProfileClicks = postData.reduce((s, p) => s + (p.profileClicks || 0), 0);
      const engRate = totalImpressions > 0 ? ((totalLikes + totalRTs + totalReplies + totalQuotes + totalBookmarks) / totalImpressions * 100).toFixed(2) : '0.00';
      return [
        '## Twitter Engagement',
        `- Engagement rate: ${engRate}% (thread self-replies corrected server-side)`,
        `- Total: ${totalLikes} likes, ${totalRTs} RTs, ${totalReplies} replies, ${totalQuotes} quotes, ${totalBookmarks} bookmarks`,
        `- Link clicks: ${totalUrlClicks} | Profile clicks: ${totalProfileClicks}`,
      ];
    },

    postMetricFields: () => ({
      impressions: 0, likes: 0, retweets: 0, replies: 0,
      quotes: 0, bookmarks: 0, urlClicks: 0, profileClicks: 0,
      isThread: false, threadLength: 1, engagementRate: 0,
    }),

    // ── Twitter-specific create-post config ──
    maxSingleChars: 25000,
    maxTweetChars: 280,
    maxThreadTweets: 6,

    extraCliArgs: (getArg, hasFlag) => ({
      format: getArg('format') || 'auto',
    }),

    parseContent: (hook, body, extra) => {
      if (extra.format === 'auto') extra.format = 'thread';
      // Normalize format names: text-thread → thread, text-single → single
      if (extra.format === 'text-thread') extra.format = 'thread';
      if (extra.format === 'text-single') extra.format = 'single';
      if (extra.format !== 'thread') return { body, parsed: {} };
      let tweets = body.split(/\n\n+/).map(t => t.trim()).filter(Boolean);
      if (tweets.length < 2) tweets = body.split(/\n/).map(t => t.trim()).filter(Boolean);
      // Only add 🧵 if thread has 2+ tweets and first tweet doesn't already have it
      if (tweets.length >= 2 && !/🧵/.test(tweets[0])) tweets[0] = tweets[0].trimEnd() + ' 🧵';
      return { body, parsed: { tweets } };
    },

    validate: (hook, body, parsed, extra) => {
      const errors = [];
      const warnings = [];
      if (extra.format === 'text-single' || extra.format === 'single') {
        if (body.length > 25000) errors.push(`Tweet exceeds 25000 char limit (Premium): ${body.length} chars`);
      } else if (extra.format === 'text-thread' || extra.format === 'thread') {
        const tweets = parsed.tweets || [];
        if (tweets.length < 2) errors.push('Thread must have at least 2 tweets. Separate tweets with double newlines.');
        if (tweets.length > 6) errors.push(`Thread has ${tweets.length} tweets (max 6)`);
        for (let i = 0; i < tweets.length; i++) {
          if (tweets[i].length > 280) errors.push(`Tweet ${i + 1} exceeds 280 chars: ${tweets[i].length} chars`);
        }
      }
      const fullText = extra.format === 'thread' ? (parsed.tweets || []).join(' ') : body;
      const emojis = fullText.match(emojiRegex) || [];
      if (emojis.length > 2) warnings.push(`${emojis.length} emoji detected (max 2 recommended)`);
      const hashtags = fullText.match(/#\w+/g) || [];
      if (hashtags.length > 1) warnings.push(`${hashtags.length} hashtags detected (max 1 recommended — prefer #buildinpublic)`);
      return { errors, warnings };
    },

    buildPlatformContents: (hook, body, parsed, extra) => {
      const twitterContent = {};
      if (extra.format === 'thread') twitterContent.thread = parsed.tweets;
      else twitterContent.content = body;
      return { twitter: twitterContent };
    },

    postExtraFields: (hook, body, parsed, extra) => ({
      format: extra.format,
      tweetCount: extra.format === 'thread' ? (parsed.tweets?.length || 1) : 1,
    }),

    dryRunDisplay: (hook, body, parsed, extra) => {
      console.log('--- POST PREVIEW ---');
      console.log(`Hook: ${hook}`);
      console.log(`Format: ${extra.format}`);
      if (extra.format === 'thread') {
        const tweets = parsed.tweets || [];
        tweets.forEach((t, i) => console.log(`  [${i + 1}] (${t.length} chars) ${t}`));
      } else {
        console.log(`Body (${body.length} chars):\n${body}`);
      }
      console.log('--- END PREVIEW ---');
    },
  },

  linkedin: {
    type: 'text',
    defaultPlatforms: ['linkedin'],
    ctaCopy: 'automate your content →',

    primaryMetric: 'impressions',
    extractMetrics: (platformData) => {
      const m = platformData?.metrics || {};
      const impressions = m.impressions || 0;
      const uniqueImpressions = m.uniqueImpressions || 0;
      const clicks = m.clicks || 0;
      const engagement = m.engagement || 0;
      const likes = m.likes || 0;
      const comments = m.comments || 0;
      const shares = m.shares || 0;
      const engagementRate = impressions > 0 ? ((likes + comments + shares + clicks) / impressions * 100) : 0;
      return {
        impressions, uniqueImpressions, clicks, engagement,
        likes, comments, shares,
        engagementRate: Math.round(engagementRate * 100) / 100,
      };
    },
    engagementFormula: (post) => {
      const impressions = post.impressions || 0;
      const interactions = (post.likes || 0) + (post.comments || 0) + (post.shares || 0) + (post.clicks || 0);
      return impressions > 0 ? Math.round(interactions / impressions * 10000) / 100 : 0;
    },
    reportExtras: (data) => {
      const { postData } = data;
      if (!postData.length) return ['- No engagement data yet'];
      const totalImpressions = postData.reduce((s, p) => s + (p.impressions || 0), 0);
      const totalLikes = postData.reduce((s, p) => s + (p.likes || 0), 0);
      const totalComments = postData.reduce((s, p) => s + (p.comments || 0), 0);
      const totalShares = postData.reduce((s, p) => s + (p.shares || 0), 0);
      const totalClicks = postData.reduce((s, p) => s + (p.clicks || 0), 0);
      const engRate = totalImpressions > 0 ? ((totalLikes + totalComments + totalShares + totalClicks) / totalImpressions * 100).toFixed(2) : '0.00';
      return [
        '## LinkedIn Engagement',
        `- Engagement rate: ${engRate}%`,
        `- Total: ${totalLikes} likes, ${totalComments} comments, ${totalShares} shares`,
        `- Clicks: ${totalClicks}`,
      ];
    },

    postMetricFields: () => ({
      impressions: 0, uniqueImpressions: 0, likes: 0, comments: 0,
      shares: 0, clicks: 0, engagement: 0, engagementRate: 0,
    }),

    preCreateCheck: () => {
      const now = new Date();
      const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      if (etNow.getDay() === 0 || etNow.getDay() === 6) {
        console.log('⚠️  Today is a weekend — LinkedIn posts should be weekdays only. Proceeding anyway.');
      }
    },

    validate: (hook, body) => {
      const errors = [];
      const warnings = [];
      if (body.length > 700) errors.push(`Content too long (${body.length} chars, max 700 for LinkedIn company pages)`);
      if (body.length > 600) warnings.push(`Content is ${body.length} chars — close to 700 char company page limit`);
      return { errors, warnings };
    },

    buildPlatformContents: (hook, body) => ({
      linkedin: { content: body },
    }),
  },

  reddit: {
    type: 'text',
    defaultPlatforms: ['reddit'],
    hookArgName: 'title',
    ctaCopy: 'been using this →',

    primaryMetric: 'score',
    extractMetrics: (platformData) => {
      const m = platformData?.metrics || {};
      return {
        score: m.score || 0,
        upvotes: m.upvotes || 0,
        upvoteRatio: m.upvoteRatio || 0,
        comments: m.comments || 0,
      };
    },
    engagementFormula: (post) => (post.score || 0) + ((post.comments || 0) * 3),
    reportExtras: (data) => {
      const { postData } = data;
      if (!postData.length) return ['- No engagement data yet'];
      const totalScore = postData.reduce((s, p) => s + (p.score || 0), 0);
      const totalComments = postData.reduce((s, p) => s + (p.comments || 0), 0);
      const avgRatio = postData.reduce((s, p) => s + (p.upvoteRatio || 0), 0) / postData.length;
      return [
        '## Reddit Engagement',
        `- Total score: ${totalScore}, comments: ${totalComments}`,
        `- Avg upvote ratio: ${(avgRatio * 100).toFixed(0)}%`,
        `- Engagement (score + comments×3): ${totalScore + totalComments * 3}`,
      ];
    },

    postMetricFields: () => ({
      score: 0, upvotes: 0, upvoteRatio: 0, comments: 0,
    }),

    validate: (hook, body) => {
      const errors = [];
      const warnings = [];
      if (hook.length > 300) errors.push(`Title too long (${hook.length}, max 300)`);
      if (body.length > 3000) errors.push(`Content too long (${body.length}, max 3000)`);
      if (/#\w+/.test(body)) warnings.push('Reddit posts should have NO hashtags');
      const emojiRe = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
      if (emojiRe.test(body)) warnings.push('Reddit posts should have NO emoji');
      return { errors, warnings };
    },

    buildPlatformContents: (hook, body) => ({
      reddit: { title: hook, content: body },
    }),
  },
};

/**
 * Get config for a platform. Throws if unknown.
 */
function getPlatformDef(platform) {
  const def = PLATFORMS[platform];
  if (!def) throw new Error(`Unknown platform: ${platform}. Known: ${Object.keys(PLATFORMS).join(', ')}`);
  return { platform, ...def };
}

/**
 * Get all visual platform names.
 */
function getVisualPlatforms() {
  return Object.entries(PLATFORMS).filter(([_, c]) => c.type === 'visual').map(([n]) => n);
}

/**
 * Get all platform names.
 */
function getAllPlatforms() {
  return Object.keys(PLATFORMS);
}

module.exports = {
  PLATFORMS,
  getPlatformDef,
  getVisualPlatforms,
  getAllPlatforms,
};
