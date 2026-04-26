/**
 * Social Media Lead Scanner
 * Sources: Twitter/X API v2 + Reddit public JSON API
 * Twitter requires TWITTER_BEARER_TOKEN
 * Reddit requires NO key — free public API
 */

const axios  = require('axios');
const { run } = require('../db/database');
const logger  = require('../services/logger');

// Phrases that signal someone wants to hire a web designer
const TWITTER_QUERIES = [
  'looking for web designer',
  'need a web designer',
  'need someone to build my website',
  'hiring web designer',
  'need website design',
  'recommend a web designer',
  'want a website built',
  'website redesign help',
];

const REDDIT_KEYWORDS = [
  'web designer', 'web design', 'website design',
  'build my website', 'need a website', 'website redesign',
  'hire a developer', 'looking for designer',
];

function getSubreddits() {
  if (process.env.REDDIT_SUBREDDITS) {
    return process.env.REDDIT_SUBREDDITS.split(',').map(s => s.trim()).filter(Boolean);
  }
  return ['Entrepreneur', 'smallbusiness', 'startups', 'hiring', 'forhire', 'web_design'];
}

function scoreLead(text, source) {
  let score = 52;
  const t = text.toLowerCase();
  if (t.includes('urgent') || t.includes('asap') || t.includes('immediately')) score += 18;
  if (t.includes('budget') || t.includes('pay') || t.includes('$'))            score += 12;
  if (t.includes('e-commerce') || t.includes('ecommerce') || t.includes('shop')) score += 10;
  if (t.includes('full website') || t.includes('complete website'))             score += 8;
  if (t.includes('redesign'))                                                   score += 8;
  if (t.includes('hire') || t.includes('hiring'))                               score += 7;
  if (source === 'Twitter')                                                     score += 5;
  return Math.min(score, 99);
}

// ── Twitter / X API v2 ────────────────────────────────────────────
async function scanTwitter() {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) {
    logger.warn('Skipping Twitter scan: TWITTER_BEARER_TOKEN not set');
    return [];
  }

  const leads = [];

  // Run 3 of the queries per scan to stay within rate limits
  for (const q of TWITTER_QUERIES.slice(0, 3)) {
    try {
      const encoded = encodeURIComponent(`${q} -is:retweet lang:en`);
      const res = await axios.get(
        `https://api.twitter.com/2/tweets/search/recent?query=${encoded}&max_results=10&tweet.fields=text,created_at,author_id&expansions=author_id&user.fields=name,username,description`,
        {
          headers : { Authorization: `Bearer ${token}` },
          timeout : 10000,
        }
      );

      const tweets = res.data.data || [];
      const usersMap = (res.data.includes?.users || []).reduce((acc, u) => {
        acc[u.id] = u;
        return acc;
      }, {});

      for (const tweet of tweets) {
        const user = usersMap[tweet.author_id] || {};
        leads.push({
          name        : user.name || `@${user.username}` || 'Twitter User',
          description : tweet.text.substring(0, 280),
          source      : 'Twitter',
          source_url  : `https://twitter.com/i/web/status/${tweet.id}`,
          industry    : 'Social Media Lead',
          budget_estimate : 'Unknown — DM to qualify',
          score       : scoreLead(tweet.text, 'Twitter'),
        });
      }

      await new Promise(r => setTimeout(r, 1500)); // rate limit: 1 req/sec
    } catch (err) {
      logger.error(`Twitter scan failed for query "${q}": ${err.message}`);
    }
  }

  logger.info(`Twitter: ${leads.length} leads found`);
  return leads;
}

// Test Twitter connection
async function testTwitterConnection() {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) return { ok: false, error: 'TWITTER_BEARER_TOKEN not set' };
  try {
    await axios.get(
      'https://api.twitter.com/2/tweets/search/recent?query=web%20designer&max_results=10',
      { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 }
    );
    return { ok: true };
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) return { ok: false, error: 'Invalid bearer token — check TWITTER_BEARER_TOKEN' };
    if (status === 429) return { ok: true, note: 'Rate limited but token is valid' };
    return { ok: false, error: err.message };
  }
}

// ── Reddit (no API key needed) ────────────────────────────────────
async function scanReddit() {
  const subreddits = getSubreddits();
  const leads = [];

  for (const sub of subreddits.slice(0, 5)) {
    try {
      const res = await axios.get(
        `https://www.reddit.com/r/${sub}/new.json?limit=25`,
        {
          headers : { 'User-Agent': 'FreeleadPro/1.0 (lead generation tool)' },
          timeout : 10000,
        }
      );

      const posts = res.data?.data?.children || [];

      for (const post of posts) {
        const { title, selftext, author, permalink } = post.data;
        const fullText = `${title} ${selftext}`;

        const matches = REDDIT_KEYWORDS.some(kw =>
          fullText.toLowerCase().includes(kw.toLowerCase())
        );
        if (!matches) continue;

        leads.push({
          name        : `u/${author}`,
          description : `[r/${sub}] ${title.substring(0, 200)}`,
          source      : 'Reddit',
          source_url  : `https://reddit.com${permalink}`,
          industry    : `r/${sub}`,
          budget_estimate : 'Unknown — check post for budget',
          score       : scoreLead(fullText, 'Reddit'),
        });
      }

      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      logger.error(`Reddit scan failed for r/${sub}: ${err.message}`);
    }
  }

  logger.info(`Reddit: ${leads.length} leads found`);
  return leads;
}

// ── Save leads to DB ──────────────────────────────────────────────
async function saveLeads(leads) {
  let saved = 0;
  for (const lead of leads) {
    try {
      const result = await run(
        `INSERT OR IGNORE INTO leads
         (name, description, source, source_url, industry, budget_estimate, score, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'New')`,
        [lead.name, lead.description, lead.source, lead.source_url,
         lead.industry, lead.budget_estimate, lead.score]
      );
      if (result.changes > 0) saved++;
    } catch (err) {
      logger.error(`Failed to save social lead: ${err.message}`);
    }
  }
  return saved;
}

async function runSocialScan() {
  logger.info('Starting social media scan (Twitter + Reddit)...');

  const [tweets, reddit] = await Promise.all([scanTwitter(), scanReddit()]);
  const all = [...tweets, ...reddit];
  const saved = await saveLeads(all);

  await run(
    'INSERT INTO scan_logs (source, leads_found, status) VALUES (?, ?, ?)',
    ['social_media', saved, 'success']
  );

  logger.info(`Social scan complete. ${saved} leads saved.`);
  return { twitter: tweets.length, reddit: reddit.length, total: all.length, saved };
}

module.exports = { runSocialScan, testTwitterConnection };
