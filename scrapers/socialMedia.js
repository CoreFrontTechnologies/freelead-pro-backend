/**
 * Social Media Scanner
 * Twitter: scrapes via Nitter (no API key needed!)
 * Reddit: uses OAuth-free public endpoints with proper headers
 */
const axios  = require('axios');
const cheerio = require('cheerio');
const { run } = require('../db/database');
const logger  = require('../services/logger');

const SKILL_TWITTER_QUERIES = {
  web_design:    ['web designer needed','need website design','hire web designer','website redesign help'],
  graphic_design:['graphic designer needed','logo design help','hire designer','need branding'],
  video_editing: ['video editor needed','hire video editor','need youtube editor','video editing help'],
  copywriting:   ['copywriter needed','need content writer','hire copywriter','content writing help'],
  social_media:  ['social media manager needed','hire social media','need instagram manager'],
  seo_marketing: ['SEO expert needed','hire SEO specialist','need digital marketing','Google ads help'],
  mobile_dev:    ['app developer needed','hire app developer','need mobile app built'],
  photography:   ['photographer needed','hire photographer','need product photos'],
  virtual_assistant:['virtual assistant needed','hire VA','need admin help'],
};

const SKILL_REDDIT_KEYWORDS = {
  web_design:    ['web designer','web design','website design','build my website','need a website'],
  graphic_design:['graphic designer','logo design','branding','need a designer','visual identity'],
  video_editing: ['video editor','video editing','youtube editor','need video editing'],
  copywriting:   ['copywriter','content writer','blog writer','need writer','ghostwriter'],
  social_media:  ['social media manager','social media help','instagram manager'],
  seo_marketing: ['SEO specialist','digital marketing','Google ads','need SEO help'],
  mobile_dev:    ['app developer','mobile app','iOS developer','android developer'],
  photography:   ['photographer','product photography','real estate photos','need photographer'],
  virtual_assistant:['virtual assistant','VA','admin help','need assistant'],
};

function getSkill() { return process.env.FREELANCE_SKILL || 'web_design'; }
function getTwitterQueries() { return (SKILL_TWITTER_QUERIES[getSkill()] || SKILL_TWITTER_QUERIES.web_design).slice(0,3); }
function getRedditKeywords() { return SKILL_REDDIT_KEYWORDS[getSkill()] || SKILL_REDDIT_KEYWORDS.web_design; }

function getSubreddits() {
  if (process.env.REDDIT_SUBREDDITS) return process.env.REDDIT_SUBREDDITS.split(',').map(s=>s.trim()).filter(Boolean);
  return ['Entrepreneur','smallbusiness','startups','forhire','hiring'];
}

function scoreIt(text, source) {
  let s = 52;
  const t = (text||'').toLowerCase();
  if (t.includes('urgent') || t.includes('asap'))    s += 18;
  if (t.includes('budget') || t.includes('$'))       s += 12;
  if (t.includes('hire') || t.includes('hiring'))    s += 8;
  if (t.includes('long term') || t.includes('ongoing')) s += 8;
  if (source === 'Twitter') s += 5;
  return Math.min(s, 99);
}

// ── Twitter via Nitter (no API key needed) ────────────────────────
// Nitter is an open-source Twitter frontend that works without the paid API
async function scanTwitterNitter() {
  const leads = [];
  const queries = getTwitterQueries();

  // Try multiple Nitter instances (they sometimes go down)
  const nitterInstances = [
    'https://nitter.privacydev.net',
    'https://nitter.poast.org',
    'https://nitter.1d4.us',
  ];

  for (const query of queries.slice(0,2)) {
    let found = false;
    for (const instance of nitterInstances) {
      try {
        const encoded = encodeURIComponent(query);
        const { data } = await axios.get(`${instance}/search?q=${encoded}&f=tweets`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
          },
          timeout: 12000,
        });

        const $ = cheerio.load(data);
        $('.tweet-content,.timeline-item').each((_, el) => {
          const text = $(el).find('.tweet-content').text().trim() || $(el).text().trim();
          const username = $(el).find('.username').text().trim() || 'Twitter User';
          if (!text || text.length < 20) return;

          leads.push({
            name        : username,
            description : text.substring(0, 280),
            source      : 'Twitter',
            source_url  : `${instance}/search?q=${encoded}`,
            industry    : 'Social Media Lead',
            budget_estimate: 'Unknown — reach out to qualify',
            score       : scoreIt(text, 'Twitter'),
          });
        });

        if (leads.length > 0) { found = true; break; }
      } catch (err) {
        logger.warn(`Nitter ${instance} failed: ${err.message}`);
      }
    }
    if (!found) logger.warn(`Twitter query "${query}": all Nitter instances failed`);
    await new Promise(r => setTimeout(r, 1000));
  }

  logger.info(`Twitter (Nitter): ${leads.length} leads`);
  return leads;
}

async function testTwitterConnection() {
  // Test Nitter instead of official API
  try {
    const { data } = await axios.get('https://nitter.privacydev.net/search?q=web+designer&f=tweets', {
      headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000,
    });
    const ok = data.includes('tweet') || data.includes('timeline');
    return { ok, note: 'Using Nitter (no API key required)', instance: 'nitter.privacydev.net' };
  } catch (err) {
    return { ok: false, error: `Nitter unavailable: ${err.message}`, note: 'Twitter scraping may be temporarily unavailable' };
  }
}

// ── Reddit (public JSON with proper headers) ──────────────────────
async function scanReddit() {
  const subreddits = getSubreddits();
  const keywords   = getRedditKeywords();
  const leads = [];

  for (const sub of subreddits.slice(0,5)) {
    try {
      // Use old.reddit.com JSON which is more permissive
      const { data } = await axios.get(`https://www.reddit.com/r/${sub}/new.json?limit=25&raw_json=1`, {
        headers: {
          'User-Agent': 'ClientHunter/1.0 (lead generation tool; contact@clienthunter.io)',
          'Accept': 'application/json',
        },
        timeout: 15000,
      });

      const posts = data?.data?.children || [];
      logger.info(`Reddit r/${sub}: ${posts.length} posts fetched`);

      for (const post of posts) {
        const { title, selftext, author, permalink, url } = post.data;
        const fullText = `${title} ${selftext||''}`;
        if (!keywords.some(kw => fullText.toLowerCase().includes(kw.toLowerCase()))) continue;

        leads.push({
          name        : `u/${author}`,
          description : `[r/${sub}] ${title.substring(0,200)}`,
          source      : 'Reddit',
          source_url  : `https://reddit.com${permalink}`,
          industry    : `r/${sub}`,
          budget_estimate: 'Unknown — check post for details',
          score       : scoreIt(fullText, 'Reddit'),
        });
      }

      await new Promise(r => setTimeout(r, 2000)); // Respect rate limits
    } catch (err) {
      logger.error(`Reddit r/${sub}: ${err.response?.status} ${err.message}`);
    }
  }

  logger.info(`Reddit: ${leads.length} leads`);
  return leads;
}

async function saveLeads(leads) {
  let saved = 0;
  for (const l of leads) {
    try {
      const r = await run(
        `INSERT OR IGNORE INTO leads (name,description,source,source_url,industry,budget_estimate,score,status) VALUES(?,?,?,?,?,?,?,'New')`,
        [l.name,l.description,l.source,l.source_url,l.industry,l.budget_estimate,l.score]
      );
      if (r.changes > 0) saved++;
    } catch (e) { logger.error(`Save social lead: ${e.message}`); }
  }
  return saved;
}

async function runSocialScan() {
  logger.info(`Social scan (skill: ${getSkill()})...`);
  const [twitter, reddit] = await Promise.allSettled([scanTwitterNitter(), scanReddit()]);
  const all = [...(twitter.value||[]), ...(reddit.value||[])];
  const saved = await saveLeads(all);
  await run('INSERT INTO scan_logs(source,leads_found,status)VALUES(?,?,?)',['social_media',saved,'success']);
  logger.info(`Social done: ${saved} saved`);
  return { twitter: (twitter.value||[]).length, reddit: (reddit.value||[]).length, total: all.length, saved };
}

module.exports = { runSocialScan, testTwitterConnection };
