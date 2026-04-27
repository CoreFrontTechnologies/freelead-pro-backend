/**
 * Social Media Scanner — Twitter/X + Reddit
 * Adapts search queries based on FREELANCE_SKILL env var
 * Twitter: needs TWITTER_BEARER_TOKEN
 * Reddit: FREE — no key needed
 */
const axios  = require('axios');
const { run } = require('../db/database');
const logger  = require('../services/logger');

const SKILL_TWITTER_QUERIES = {
  web_design:    ['looking for web designer','need a web designer','need website design','hiring web designer','website redesign help'],
  graphic_design:['looking for graphic designer','need logo design','hiring graphic designer','need branding help','need a designer'],
  video_editing: ['looking for video editor','need video editing','hiring video editor','need youtube editor','video content help'],
  copywriting:   ['looking for copywriter','need content writer','hiring copywriter','need blog writer','content writing help'],
  social_media:  ['looking for social media manager','need social media help','hiring social media','need instagram manager'],
  seo_marketing: ['looking for SEO expert','need digital marketing','hiring SEO specialist','need Google ads help','marketing help'],
  mobile_dev:    ['looking for app developer','need mobile app built','hiring app developer','need iOS developer'],
  photography:   ['looking for photographer','need product photos','hiring photographer','need real estate photos'],
  virtual_assistant:['looking for virtual assistant','need a VA','hiring virtual assistant','need admin help'],
};

const SKILL_REDDIT_KEYWORDS = {
  web_design:    ['web designer','web design','website design','build my website','need a website','website redesign'],
  graphic_design:['graphic designer','logo design','branding','visual identity','need a designer','brand identity'],
  video_editing: ['video editor','video editing','youtube editor','content creator','need video editing','motion graphics'],
  copywriting:   ['copywriter','content writer','blog writer','SEO content','need writer','ghostwriter'],
  social_media:  ['social media manager','social media help','instagram manager','need social media','facebook marketing'],
  seo_marketing: ['SEO specialist','digital marketing','Google ads','PPC','need SEO help','marketing consultant'],
  mobile_dev:    ['app developer','mobile app','iOS developer','android developer','need app built','react native'],
  photography:   ['photographer','product photography','real estate photos','need photographer','event photographer'],
  virtual_assistant:['virtual assistant','VA','admin help','need assistant','executive assistant'],
};

const SKILL_SUBREDDITS = {
  web_design:    ['Entrepreneur','smallbusiness','startups','hiring','forhire','web_design','webdev'],
  graphic_design:['Entrepreneur','smallbusiness','startups','hiring','forhire','graphic_design','branding'],
  video_editing: ['Entrepreneur','smallbusiness','startups','hiring','forhire','videography','NewTubers'],
  copywriting:   ['Entrepreneur','smallbusiness','startups','hiring','forhire','copywriting','content_marketing'],
  social_media:  ['Entrepreneur','smallbusiness','startups','hiring','forhire','socialmedia','marketing'],
  seo_marketing: ['Entrepreneur','smallbusiness','startups','hiring','forhire','SEO','digital_marketing'],
  mobile_dev:    ['Entrepreneur','smallbusiness','startups','hiring','forhire','androiddev','iOSProgramming'],
  photography:   ['Entrepreneur','smallbusiness','startups','hiring','forhire','photography','RealEstate'],
  virtual_assistant:['Entrepreneur','smallbusiness','startups','hiring','forhire','entrepreneurs','productivity'],
};

function getSkill() { return process.env.FREELANCE_SKILL || 'web_design'; }
function getTwitterQueries() { return (SKILL_TWITTER_QUERIES[getSkill()] || SKILL_TWITTER_QUERIES.web_design).slice(0,3); }
function getRedditKeywords() { return SKILL_REDDIT_KEYWORDS[getSkill()] || SKILL_REDDIT_KEYWORDS.web_design; }
function getSubreddits() {
  if (process.env.REDDIT_SUBREDDITS) return process.env.REDDIT_SUBREDDITS.split(',').map(s=>s.trim());
  return (SKILL_SUBREDDITS[getSkill()] || SKILL_SUBREDDITS.web_design).slice(0,5);
}

function scoreLead(text, source) {
  let s = 52;
  const t = (text||'').toLowerCase();
  if (t.includes('urgent') || t.includes('asap'))  s += 18;
  if (t.includes('budget') || t.includes('$'))     s += 12;
  if (t.includes('hire') || t.includes('hiring'))  s += 8;
  if (t.includes('long term') || t.includes('ongoing')) s += 8;
  if (source === 'Twitter')                         s += 5;
  return Math.min(s, 99);
}

async function scanTwitter() {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) { logger.warn('Skipping Twitter: TWITTER_BEARER_TOKEN not set'); return []; }
  const leads = [];
  for (const q of getTwitterQueries()) {
    try {
      const encoded = encodeURIComponent(`${q} -is:retweet lang:en`);
      const res = await axios.get(
        `https://api.twitter.com/2/tweets/search/recent?query=${encoded}&max_results=10&tweet.fields=text,author_id&expansions=author_id&user.fields=name,username`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
      );
      const tweets = res.data.data || [];
      const usersMap = (res.data.includes?.users||[]).reduce((a,u)=>{a[u.id]=u;return a;},{});
      for (const tweet of tweets) {
        const user = usersMap[tweet.author_id] || {};
        leads.push({
          name: user.name || `@${user.username}` || 'Twitter User',
          description: tweet.text.substring(0,280),
          source: 'Twitter',
          source_url: `https://twitter.com/i/web/status/${tweet.id}`,
          industry: 'Social Media Lead', budget_estimate: 'Unknown — DM to qualify',
          score: scoreLead(tweet.text, 'Twitter'),
        });
      }
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) { logger.error(`Twitter query "${q}": ${err.message}`); }
  }
  logger.info(`Twitter: ${leads.length} leads`);
  return leads;
}

async function testTwitterConnection() {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) return { ok: false, error: 'TWITTER_BEARER_TOKEN not set' };
  try {
    await axios.get('https://api.twitter.com/2/tweets/search/recent?query=hello&max_results=10',
      { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 });
    return { ok: true };
  } catch (err) {
    if (err.response?.status === 401) return { ok: false, error: 'Invalid bearer token' };
    if (err.response?.status === 429) return { ok: true, note: 'Rate limited but token is valid' };
    return { ok: false, error: err.message };
  }
}

async function scanReddit() {
  const subreddits = getSubreddits();
  const keywords   = getRedditKeywords();
  const leads = [];
  for (const sub of subreddits) {
    try {
      const { data } = await axios.get(`https://www.reddit.com/r/${sub}/new.json?limit=25`, {
        headers: { 'User-Agent': 'ClientHunter/1.0' }, timeout: 10000,
      });
      const posts = data?.data?.children || [];
      for (const post of posts) {
        const { title, selftext, author, permalink } = post.data;
        const fullText = `${title} ${selftext}`;
        if (!keywords.some(kw => fullText.toLowerCase().includes(kw.toLowerCase()))) continue;
        leads.push({
          name: `u/${author}`,
          description: `[r/${sub}] ${title.substring(0,200)}`,
          source: 'Reddit',
          source_url: `https://reddit.com${permalink}`,
          industry: `r/${sub}`, budget_estimate: 'Unknown — check post',
          score: scoreLead(fullText, 'Reddit'),
        });
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) { logger.error(`Reddit r/${sub}: ${err.message}`); }
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
  const [tweets, reddit] = await Promise.all([scanTwitter(), scanReddit()]);
  const all = [...tweets, ...reddit];
  const saved = await saveLeads(all);
  await run('INSERT INTO scan_logs(source,leads_found,status)VALUES(?,?,?)',['social_media',saved,'success']);
  logger.info(`Social done: ${saved} saved`);
  return { twitter: tweets.length, reddit: reddit.length, total: all.length, saved };
}

module.exports = { runSocialScan, testTwitterConnection };
