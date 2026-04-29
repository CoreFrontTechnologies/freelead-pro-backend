/**
 * Social Media & Free Lead Sources — NO API KEYS REQUIRED
 * Sources: HackerNews | Craigslist | GitHub | ProductHunt | Reddit (via proxy)
 * Twitter removed — replaced with better free alternatives
 * LinkedIn: only if GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX are set
 */
const axios   = require('axios');
const cheerio = require('cheerio');
const { run } = require('../db/database');
const logger  = require('../services/logger');

const SKILL_KEYWORDS = {
  web_design:        ['web design','web designer','website','frontend','UI design','UX design','webflow','wordpress','landing page'],
  graphic_design:    ['graphic design','graphic designer','logo','branding','brand identity','illustrator'],
  video_editing:     ['video editor','video editing','youtube editor','motion graphics','videographer'],
  copywriting:       ['copywriter','content writer','blog writer','ghostwriter','SEO writer'],
  social_media:      ['social media manager','instagram manager','community manager','social media marketing'],
  seo_marketing:     ['SEO','digital marketing','Google ads','PPC','marketing consultant'],
  mobile_dev:        ['mobile developer','app developer','iOS','android','react native','flutter'],
  photography:       ['photographer','product photography','real estate photos','commercial photography'],
  virtual_assistant: ['virtual assistant','VA','admin assistant','executive assistant'],
};

function getSkill()    { return process.env.FREELANCE_SKILL || 'web_design'; }
function getKeywords() { return SKILL_KEYWORDS[getSkill()] || SKILL_KEYWORDS.web_design; }

function scoreIt(text) {
  let s = 52;
  const t = (text||'').toLowerCase();
  if (t.includes('urgent') || t.includes('asap'))       s += 18;
  if (t.includes('budget') || t.includes('$'))          s += 12;
  if (t.includes('hire') || t.includes('hiring'))       s += 8;
  if (t.includes('long term') || t.includes('ongoing')) s += 8;
  if (t.includes('paid') || t.includes('compensation')) s += 6;
  return Math.min(s, 99);
}

// ── HackerNews "Who is Hiring" — FREE official Algolia API ────────
async function scanHackerNews() {
  const keywords = getKeywords();
  const leads    = [];
  try {
    logger.info('Scanning HackerNews Who is Hiring...');

    // Find latest monthly hiring thread
    const { data: search } = await axios.get(
      'https://hn.algolia.com/api/v1/search?query=Ask+HN+who+is+hiring&tags=ask_hn&hitsPerPage=3',
      { timeout: 12000 }
    );

    const thread = search.hits?.[0];
    if (!thread) { logger.warn('HN: No hiring thread found'); return []; }
    logger.info(`HN: Thread found — "${thread.title}" id:${thread.objectID}`);

    // Get job comments from that thread
    const { data: comments } = await axios.get(
      `https://hn.algolia.com/api/v1/search?tags=comment,story_${thread.objectID}&hitsPerPage=100&attributesToRetrieve=comment_text,author,objectID`,
      { timeout: 12000 }
    );

    for (const c of (comments.hits || [])) {
      const text = (c.comment_text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim();
      if (text.length < 50) continue;
      if (!keywords.some(kw => text.toLowerCase().includes(kw.toLowerCase()))) continue;

      const firstLine = text.split(/\n|\|/)[0].substring(0, 80).trim();
      leads.push({
        name        : firstLine || `HN User ${c.author}`,
        description : `HN Hiring: ${text.substring(0, 220)}`,
        source      : 'HackerNews',
        source_url  : `https://news.ycombinator.com/item?id=${c.objectID}`,
        industry    : 'Tech / Startup',
        budget_estimate: 'See post for salary/rate',
        score       : scoreIt(text),
      });
    }
    logger.info(`HackerNews: ${leads.length} leads`);
  } catch (err) { logger.error(`HackerNews: ${err.message}`); }
  return leads;
}

// ── Craigslist (public HTML, no key needed) ───────────────────────
async function scanCraigslist() {
  const leads    = [];
  const keywords = getKeywords();
  const skill    = getSkill();

  // Category codes per skill
  const catMap = {
    web_design: 'cpg', graphic_design: 'crg', video_editing: 'cpv',
    copywriting: 'cpw', social_media: 'cpg', seo_marketing: 'cpg',
    mobile_dev: 'cpg', photography: 'cpv', virtual_assistant: 'ofc',
  };
  const cat = catMap[skill] || 'cpg';

  // City subdomains — mix of US and international
  const cities = (process.env.CRAIGSLIST_CITIES || 'newyork,losangeles,chicago,sfbay,seattle').split(',').map(c=>c.trim());

  for (const city of cities.slice(0, 3)) {
    try {
      const { data } = await axios.get(
        `https://${city}.craigslist.org/search/${cat}`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 12000 }
      );
      const $ = cheerio.load(data);

      // Craigslist search results
      $('.result-row, .cl-search-result').each((_, el) => {
        const title = $(el).find('.result-title, .cl-search-result-title').text().trim();
        const link  = $(el).find('a.result-title, a.cl-search-result-title').attr('href') || '';
        if (!title) return;
        if (!keywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()))) return;

        leads.push({
          name        : `Craigslist: ${title.substring(0, 70)}`,
          description : `Local gig in ${city}: ${title}`,
          source      : 'Craigslist',
          source_url  : link.startsWith('http') ? link : `https://${city}.craigslist.org${link}`,
          industry    : 'Local / Gig',
          budget_estimate: 'See post',
          score       : scoreIt(title),
        });
      });

      logger.info(`Craigslist ${city}/${cat}: ${leads.length} total so far`);
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) { logger.warn(`Craigslist ${city}: ${err.message}`); }
  }

  logger.info(`Craigslist: ${leads.length} leads`);
  return leads;
}

// ── GitHub Issues tagged hiring/freelance — FREE API ──────────────
async function scanGitHub() {
  const leads    = [];
  const skill    = getSkill();
  const devSkills = ['web_design','mobile_dev','seo_marketing','copywriting'];
  if (!devSkills.includes(skill)) return [];

  const queryMap = {
    web_design:  'frontend+developer+hiring+OR+freelance',
    mobile_dev:  'mobile+developer+hiring+OR+freelance',
    copywriting: 'technical+writer+hiring+OR+freelance',
    seo_marketing: 'growth+marketing+hiring+OR+freelance',
  };

  try {
    const q = queryMap[skill] || 'freelancer+wanted';
    const { data } = await axios.get(
      `https://api.github.com/search/issues?q=${q}&sort=created&order=desc&per_page=15`,
      {
        headers: { 'User-Agent': 'ClientHunter/1.0', 'Accept': 'application/vnd.github.v3+json' },
        timeout: 12000,
      }
    );

    for (const issue of (data.items || [])) {
      leads.push({
        name        : issue.user?.login ? `GitHub: ${issue.user.login}` : 'GitHub Issue',
        description : issue.title?.substring(0, 200) || '',
        source      : 'GitHub',
        source_url  : issue.html_url,
        industry    : 'Tech / Open Source',
        budget_estimate: 'Check issue for details',
        score       : scoreIt((issue.title||'') + ' ' + (issue.body||'').substring(0,200)),
      });
    }
    logger.info(`GitHub: ${leads.length} leads`);
  } catch (err) { logger.warn(`GitHub: ${err.message}`); }
  return leads;
}

// ── Reddit via multiple fallback proxies ──────────────────────────
async function scanReddit() {
  const keywords  = getKeywords();
  const subreddits = (process.env.REDDIT_SUBREDDITS||'Entrepreneur,smallbusiness,forhire,hiring,startups')
    .split(',').map(s=>s.trim()).slice(0,4);
  const leads = [];

  for (const sub of subreddits) {
    // Try multiple access methods
    const attempts = [
      // Method 1: pushshift (sometimes works)
      async () => {
        const { data } = await axios.get(
          `https://api.pushshift.io/reddit/search/submission/?subreddit=${sub}&size=20&sort=desc`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }
        );
        return (data?.data || []).map(p => ({ title: p.title, text: p.selftext||'', author: p.author, permalink: p.permalink }));
      },
      // Method 2: Reddit JSON with browser-like headers
      async () => {
        const { data } = await axios.get(
          `https://www.reddit.com/r/${sub}/new.json?limit=20&raw_json=1`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5',
              'Referer': 'https://www.reddit.com/',
            },
            timeout: 12000,
          }
        );
        return (data?.data?.children||[]).map(c => ({ title: c.data.title, text: c.data.selftext||'', author: c.data.author, permalink: c.data.permalink }));
      },
    ];

    let fetched = false;
    for (const attempt of attempts) {
      try {
        const posts = await attempt();
        logger.info(`Reddit r/${sub}: ${posts.length} posts`);
        for (const p of posts) {
          const fullText = `${p.title} ${p.text}`;
          if (!keywords.some(kw => fullText.toLowerCase().includes(kw.toLowerCase()))) continue;
          leads.push({
            name: `u/${p.author}`,
            description: `[r/${sub}] ${p.title.substring(0,200)}`,
            source: 'Reddit',
            source_url: `https://reddit.com${p.permalink}`,
            industry: `r/${sub}`, budget_estimate: 'Check post',
            score: scoreIt(fullText),
          });
        }
        fetched = true;
        break;
      } catch (err) { logger.warn(`Reddit r/${sub} attempt: ${err.response?.status||''} ${err.message}`); }
    }
    if (!fetched) logger.error(`Reddit r/${sub}: all methods failed — Railway IP may be blocked by Reddit`);
    await new Promise(r => setTimeout(r, 2000));
  }

  logger.info(`Reddit: ${leads.length} leads`);
  return leads;
}

// ── LinkedIn via Google Custom Search ─────────────────────────────
async function scanLinkedInViaGoogle() {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx  = process.env.GOOGLE_SEARCH_CX;
  const leads = [];
  if (!key || !cx) { logger.warn('LinkedIn scan: GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX not set'); return []; }

  const skillLabel = getSkill().replace(/_/g,' ');
  const queries = [
    `site:linkedin.com/jobs "${skillLabel}" freelance OR contract OR remote`,
    `site:linkedin.com "hiring ${skillLabel}" OR "looking for ${skillLabel}"`,
  ];

  for (const q of queries.slice(0,2)) {
    try {
      const { data } = await axios.get('https://www.googleapis.com/customsearch/v1', {
        params: { key, cx, q, num: 10 }, timeout: 12000,
      });
      for (const item of (data.items || [])) {
        leads.push({
          name        : (item.title||'').split('|')[0].split('-')[0].trim().substring(0,60) || 'LinkedIn Lead',
          description : `LinkedIn: ${(item.snippet||'').substring(0,200)}`,
          source      : 'LinkedIn',
          source_url  : item.link,
          industry    : 'LinkedIn', budget_estimate: 'Check post',
          score       : scoreIt((item.title||'')+(item.snippet||'')),
        });
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) { logger.error(`LinkedIn Google search: ${err.message}`); }
  }

  logger.info(`LinkedIn via Google: ${leads.length} leads`);
  return leads;
}

// ── Save leads ────────────────────────────────────────────────────
async function saveLeads(leads) {
  let saved = 0;
  for (const l of leads) {
    try {
      const r = await run(
        `INSERT OR IGNORE INTO leads (name,description,source,source_url,industry,budget_estimate,score,status) VALUES(?,?,?,?,?,?,?,'New')`,
        [l.name,l.description,l.source,l.source_url,l.industry,l.budget_estimate,l.score]
      );
      if (r.changes > 0) saved++;
    } catch (e) { logger.error(`Save lead: ${e.message}`); }
  }
  return saved;
}

async function testTwitterConnection() {
  // Twitter removed — test HackerNews instead
  try {
    const { data } = await axios.get(
      'https://hn.algolia.com/api/v1/search?query=who+is+hiring&tags=ask_hn&hitsPerPage=1',
      { timeout: 8000 }
    );
    return {
      ok: !!data.hits?.length,
      note: 'Twitter replaced with: HackerNews ✅ + Craigslist ✅ + GitHub ✅ + Reddit + LinkedIn via Google',
      hn_threads: data.hits?.length || 0,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function runSocialScan() {
  logger.info(`Social scan (skill: ${getSkill()})...`);
  const results = await Promise.allSettled([
    scanHackerNews(),
    scanCraigslist(),
    scanGitHub(),
    scanReddit(),
    scanLinkedInViaGoogle(),
  ]);

  const [hn, cl, gh, rd, li] = results.map(r => r.value || []);
  const all = [...hn, ...cl, ...gh, ...rd, ...li];

  logger.info(`Results — HN:${hn.length} CL:${cl.length} GH:${gh.length} Reddit:${rd.length} LinkedIn:${li.length} | Total:${all.length}`);
  const saved = await saveLeads(all);
  await run('INSERT INTO scan_logs(source,leads_found,status)VALUES(?,?,?)', ['social_media', saved, 'success']);
  logger.info(`Social scan done: ${saved} new leads saved`);
  return { hackerNews: hn.length, craigslist: cl.length, github: gh.length, reddit: rd.length, linkedin: li.length, total: all.length, saved };
}

module.exports = { runSocialScan, testTwitterConnection };
