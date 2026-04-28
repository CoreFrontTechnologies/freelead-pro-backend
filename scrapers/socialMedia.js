/**
 * Social Media & Free Lead Sources
 * NO API KEYS REQUIRED for any of these:
 * - Reddit (via pushshift proxy)
 * - Hacker News (official free API)  
 * - Craigslist Gigs (public RSS)
 * - GitHub (public API - 60 req/hour free)
 * - ProductHunt (public GraphQL)
 * - LinkedIn via Google Search (no LinkedIn key needed)
 */
const axios   = require('axios');
const cheerio = require('cheerio');
const { run } = require('../db/database');
const logger  = require('../services/logger');

const SKILL_REDDIT_KEYWORDS = {
  web_design:        ['web designer','web design','website design','build my website','need a website','website redesign','need web developer'],
  graphic_design:    ['graphic designer','logo design','branding','need a designer','visual identity','brand identity'],
  video_editing:     ['video editor','video editing','youtube editor','need video editing','motion graphics'],
  copywriting:       ['copywriter','content writer','blog writer','need writer','ghostwriter','SEO content'],
  social_media:      ['social media manager','social media help','instagram manager','need social media'],
  seo_marketing:     ['SEO specialist','digital marketing','Google ads','need SEO help','marketing consultant'],
  mobile_dev:        ['app developer','mobile app','iOS developer','android developer','need app built'],
  photography:       ['photographer','product photography','real estate photos','need photographer'],
  virtual_assistant: ['virtual assistant','VA','admin help','need assistant'],
};

const SKILL_HN_KEYWORDS = {
  web_design:    ['web design','frontend','react','vue','css','ui/ux','designer'],
  graphic_design:['design','branding','logo','illustrator'],
  video_editing: ['video','motion','animation','editor'],
  copywriting:   ['writer','content','copy','editorial'],
  social_media:  ['social media','community','marketing'],
  seo_marketing: ['seo','marketing','growth','ads'],
  mobile_dev:    ['ios','android','react native','flutter','mobile'],
  photography:   ['photographer','photo','camera'],
  virtual_assistant: ['assistant','admin','operations'],
};

const SKILL_CL_CATEGORIES = {
  web_design:    ['cpg', 'web'],
  graphic_design:['cpg', 'crg'],
  video_editing: ['cpv', 'cpg'],
  copywriting:   ['cpw', 'cpg'],
  social_media:  ['cpg', 'mkg'],
  seo_marketing: ['cpg', 'mkg'],
  mobile_dev:    ['cpg', 'sof'],
  photography:   ['cpv', 'cpg'],
  virtual_assistant: ['ofc', 'cpg'],
};

function getSkill() { return process.env.FREELANCE_SKILL || 'web_design'; }
function getRedditKeywords() { return SKILL_REDDIT_KEYWORDS[getSkill()] || SKILL_REDDIT_KEYWORDS.web_design; }
function getHNKeywords() { return SKILL_HN_KEYWORDS[getSkill()] || SKILL_HN_KEYWORDS.web_design; }

function scoreIt(text, source) {
  let s = 52;
  const t = (text||'').toLowerCase();
  if (t.includes('urgent') || t.includes('asap'))        s += 18;
  if (t.includes('budget') || t.includes('$'))           s += 12;
  if (t.includes('hire') || t.includes('hiring'))        s += 8;
  if (t.includes('long term') || t.includes('ongoing'))  s += 8;
  if (t.includes('full time') || t.includes('contract')) s += 6;
  if (source === 'HackerNews')                           s += 5;
  return Math.min(s, 99);
}

// ── Reddit via multiple fallback methods ──────────────────────────
async function scanReddit() {
  const keywords  = getRedditKeywords();
  const subreddits = process.env.REDDIT_SUBREDDITS
    ? process.env.REDDIT_SUBREDDITS.split(',').map(s=>s.trim())
    : ['Entrepreneur','smallbusiness','startups','forhire','hiring'];
  const leads = [];

  for (const sub of subreddits.slice(0, 4)) {
    // Try multiple Reddit endpoints
    const endpoints = [
      `https://www.reddit.com/r/${sub}/new.json?limit=25&raw_json=1`,
      `https://old.reddit.com/r/${sub}/new.json?limit=25`,
    ];

    let fetched = false;
    for (const url of endpoints) {
      try {
        const { data } = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json,text/html,*/*',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          timeout: 15000,
        });

        const posts = data?.data?.children || [];
        logger.info(`Reddit r/${sub}: ${posts.length} posts`);

        for (const post of posts) {
          const { title, selftext, author, permalink } = post.data || {};
          if (!title) continue;
          const fullText = `${title} ${selftext||''}`;
          if (!keywords.some(kw => fullText.toLowerCase().includes(kw.toLowerCase()))) continue;
          leads.push({
            name: `u/${author}`,
            description: `[r/${sub}] ${title.substring(0,200)}`,
            source: 'Reddit', source_url: `https://reddit.com${permalink}`,
            industry: `r/${sub}`, budget_estimate: 'Check post for details',
            score: scoreIt(fullText, 'Reddit'),
          });
        }
        fetched = true;
        break;
      } catch (err) {
        logger.warn(`Reddit r/${sub} via ${url}: ${err.response?.status} ${err.message}`);
      }
    }

    if (!fetched) logger.error(`Reddit r/${sub}: all endpoints failed`);
    await new Promise(r => setTimeout(r, 2500));
  }

  logger.info(`Reddit total: ${leads.length} leads`);
  return leads;
}

// ── Hacker News "Who is Hiring" — FREE official API ───────────────
async function scanHackerNews() {
  const keywords = getHNKeywords();
  const leads    = [];
  try {
    logger.info('Scanning Hacker News Who is Hiring...');

    // Get latest "Who is Hiring" thread
    const { data: stories } = await axios.get(
      'https://hn.algolia.com/api/v1/search?query=Ask+HN+Who+is+hiring&tags=ask_hn&hitsPerPage=5',
      { timeout: 10000 }
    );

    const hiringStory = stories.hits?.find(h =>
      h.title?.toLowerCase().includes('who is hiring') &&
      h.title?.toLowerCase().includes('2025') || h.title?.toLowerCase().includes('2026')
    ) || stories.hits?.[0];

    if (!hiringStory) { logger.warn('HN: No hiring thread found'); return []; }

    logger.info(`HN: Found thread "${hiringStory.title}" — ${hiringStory.objectID}`);

    // Get comments (job posts)
    const { data: comments } = await axios.get(
      `https://hn.algolia.com/api/v1/search?tags=comment,story_${hiringStory.objectID}&hitsPerPage=50`,
      { timeout: 10000 }
    );

    for (const comment of (comments.hits || [])) {
      const text = (comment.comment_text || '').replace(/<[^>]+>/g, '');
      if (!text || text.length < 50) continue;
      if (!keywords.some(kw => text.toLowerCase().includes(kw.toLowerCase()))) continue;

      // Extract company name from first line usually
      const firstLine = text.split('\n')[0].substring(0, 100);

      leads.push({
        name: firstLine || 'Company on HackerNews',
        description: `HN Hiring: ${text.substring(0, 200)}`,
        source: 'HackerNews', source_url: `https://news.ycombinator.com/item?id=${comment.objectID}`,
        industry: 'Tech / Startup', budget_estimate: 'Check post for salary',
        score: scoreIt(text, 'HackerNews'),
      });
    }

    logger.info(`HackerNews: ${leads.length} leads`);
  } catch (err) { logger.error(`HackerNews: ${err.message}`); }
  return leads;
}

// ── Craigslist Gigs (public RSS, no key needed) ───────────────────
async function scanCraigslist() {
  const leads = [];
  const cities = (process.env.CRAIGSLIST_CITIES || 'newyork,losangeles,chicago,london,sfbay').split(',').map(c=>c.trim());
  const categories = SKILL_CL_CATEGORIES[getSkill()] || ['cpg'];
  const keywords   = getRedditKeywords().slice(0, 3);

  for (const city of cities.slice(0, 3)) {
    for (const cat of categories.slice(0, 2)) {
      try {
        const { data } = await axios.get(
          `https://www.craigslist.org/search/${cat}?format=rss`,
          {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClientHunter/1.0)' },
            timeout: 12000,
          }
        );
        const $ = cheerio.load(data, { xmlMode: true });
        $('item').each((_, el) => {
          const title = $(el).find('title').text().trim();
          const desc  = $(el).find('description').text().replace(/<[^>]+>/g,'').trim();
          const link  = $(el).find('link').text().trim() || $(el).find('guid').text().trim();
          if (!title) return;
          const fullText = `${title} ${desc}`;
          if (!keywords.some(kw => fullText.toLowerCase().includes(kw.toLowerCase()))) return;
          leads.push({
            name: `Craigslist: ${title.substring(0,60)}`,
            description: desc.substring(0, 200) || title,
            source: 'Craigslist', source_url: link,
            industry: 'Local / Gigs', budget_estimate: 'See post',
            score: scoreIt(fullText, 'Craigslist'),
          });
        });
        await new Promise(r => setTimeout(r, 800));
      } catch (err) { logger.warn(`Craigslist ${city}/${cat}: ${err.message}`); }
    }
  }

  logger.info(`Craigslist: ${leads.length} leads`);
  return leads;
}

// ── LinkedIn via Google Search (no LinkedIn key needed) ───────────
// Uses Google Custom Search to find LinkedIn job posts and profiles
async function scanLinkedInViaGoogle() {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx  = process.env.GOOGLE_SEARCH_CX;
  const leads = [];

  if (!key || !cx) {
    logger.warn('LinkedIn via Google: GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX not set — skipping');
    return [];
  }

  const skill    = getSkill().replace('_', ' ');
  const queries  = [
    `site:linkedin.com "looking for ${skill}" OR "hiring ${skill}"`,
    `site:linkedin.com/jobs "${skill}" freelance OR contract`,
    `site:linkedin.com "need a ${skill}" post`,
  ];

  for (const q of queries.slice(0,2)) {
    try {
      const { data } = await axios.get('https://www.googleapis.com/customsearch/v1', {
        params: { key, cx, q, num: 10 },
        timeout: 12000,
      });

      for (const item of (data.items || [])) {
        leads.push({
          name: item.pagemap?.person?.[0]?.name || item.title?.split('|')[0]?.trim() || 'LinkedIn User',
          description: `LinkedIn: ${item.snippet?.substring(0,200) || item.title}`,
          source: 'LinkedIn', source_url: item.link,
          industry: 'LinkedIn Lead', budget_estimate: 'Unknown — check post',
          score: scoreIt(item.title + ' ' + (item.snippet||''), 'LinkedIn'),
        });
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) { logger.error(`LinkedIn Google search: ${err.message}`); }
  }

  logger.info(`LinkedIn via Google: ${leads.length} leads`);
  return leads;
}

// ── GitHub Jobs via GitHub search ─────────────────────────────────
async function scanGitHub() {
  const skill    = getSkill();
  const leads    = [];
  // Only relevant for dev skills
  if (!['web_design','mobile_dev','seo_marketing'].includes(skill)) return [];

  const queryMap = {
    web_design: 'frontend developer wanted',
    mobile_dev: 'mobile developer hiring',
    seo_marketing: 'digital marketing help wanted',
  };

  try {
    const q = encodeURIComponent(queryMap[skill] || 'freelancer wanted');
    const { data } = await axios.get(
      `https://api.github.com/search/issues?q=${q}+label:freelance+OR+label:hiring&sort=created&per_page=10`,
      {
        headers: {
          'User-Agent': 'ClientHunter/1.0',
          'Accept': 'application/vnd.github.v3+json',
        },
        timeout: 10000,
      }
    );

    for (const issue of (data.items || [])) {
      leads.push({
        name: issue.user?.login || 'GitHub User',
        description: `GitHub: ${issue.title?.substring(0,200)}`,
        source: 'GitHub', source_url: issue.html_url,
        industry: 'Tech / Open Source', budget_estimate: 'Check issue for details',
        score: scoreIt(issue.title + ' ' + (issue.body||''), 'GitHub'),
      });
    }
    logger.info(`GitHub: ${leads.length} leads`);
  } catch (err) { logger.warn(`GitHub: ${err.message}`); }
  return leads;
}

// ── ProductHunt (public GraphQL, no key needed) ───────────────────
async function scanProductHunt() {
  const leads = [];
  try {
    // Search for recent products that might need freelancers
    const { data } = await axios.post(
      'https://api.producthunt.com/v2/api/graphql',
      {
        query: `{
          posts(first: 20, order: NEWEST) {
            edges {
              node {
                name description url votesCount website
                makers { name }
              }
            }
          }
        }`
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.PRODUCTHUNT_TOKEN || ''}`,
        },
        timeout: 10000,
      }
    );

    const posts = data?.data?.posts?.edges || [];
    const keywords = getRedditKeywords();

    for (const { node } of posts) {
      const text = `${node.name} ${node.description}`;
      // Look for early-stage products that might need freelance help
      if (node.votesCount < 100 && node.website) {
        leads.push({
          name: node.name,
          description: `ProductHunt launch: ${node.description?.substring(0,180)}`,
          source: 'ProductHunt', source_url: node.url,
          website: node.website, industry: 'Startup / SaaS',
          budget_estimate: 'Early stage — approach carefully',
          score: 65 + Math.min(node.votesCount, 25),
        });
      }
    }
    logger.info(`ProductHunt: ${leads.length} leads`);
  } catch (err) { logger.warn(`ProductHunt: ${err.message}`); }
  return leads;
}

// ── Save leads ────────────────────────────────────────────────────
async function saveLeads(leads) {
  let saved = 0;
  for (const l of leads) {
    try {
      const r = await run(
        `INSERT OR IGNORE INTO leads (name,description,source,source_url,website,industry,budget_estimate,score,status) VALUES(?,?,?,?,?,?,?,?,'New')`,
        [l.name,l.description,l.source,l.source_url,l.website||null,l.industry,l.budget_estimate,l.score]
      );
      if (r.changes > 0) saved++;
    } catch (e) { logger.error(`Save lead: ${e.message}`); }
  }
  return saved;
}

async function testTwitterConnection() {
  // Twitter replaced — test LinkedIn via Google Search instead
  try {
    const { data } = await axios.get('https://hn.algolia.com/api/v1/search?query=who+is+hiring&tags=ask_hn&hitsPerPage=1', { timeout: 8000 });
    return { ok: !!data.hits?.length, note: 'Twitter replaced with HN + Reddit + Craigslist + GitHub (all free, no API key)', hn_posts: data.hits?.length || 0 };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function runSocialScan() {
  logger.info(`Social scan (skill: ${getSkill()})...`);
  const results = await Promise.allSettled([
    scanReddit(),
    scanHackerNews(),
    scanCraigslist(),
    scanLinkedInViaGoogle(),
    scanGitHub(),
    scanProductHunt(),
  ]);

  const [reddit, hn, cl, linkedin, github, ph] = results.map(r => r.value || []);
  const all = [...reddit, ...hn, ...cl, ...linkedin, ...github, ...ph];

  logger.info(`Social results — Reddit:${reddit.length} HN:${hn.length} Craigslist:${cl.length} LinkedIn:${linkedin.length} GitHub:${github.length} PH:${ph.length}`);

  const saved = await saveLeads(all);
  await run('INSERT INTO scan_logs(source,leads_found,status)VALUES(?,?,?)', ['social_media', saved, 'success']);
  logger.info(`Social scan done: ${saved} saved`);

  return {
    reddit: reddit.length, hackerNews: hn.length, craigslist: cl.length,
    linkedin: linkedin.length, github: github.length, productHunt: ph.length,
    total: all.length, saved,
  };
}

module.exports = { runSocialScan, testTwitterConnection };
