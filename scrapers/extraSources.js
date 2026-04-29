/**
 * Extra Free Lead Sources — NO API KEYS REQUIRED
 * PeoplePerHour | Guru.com | SimplyHired | Bark.com | Clutch.co
 */
const axios   = require('axios');
const cheerio = require('cheerio');
const { run } = require('../db/database');
const logger  = require('../services/logger');

const SKILL_KEYWORDS = {
  web_design:        ['web design','web designer','website','frontend','UI','UX','webflow','wordpress','landing page'],
  graphic_design:    ['graphic design','logo','branding','brand identity','illustration'],
  video_editing:     ['video editor','video editing','motion graphics','animation','youtube'],
  copywriting:       ['copywriter','content writer','blog','ghostwriter','SEO writer'],
  social_media:      ['social media','instagram','community manager','facebook','content creator'],
  seo_marketing:     ['SEO','digital marketing','Google ads','PPC','marketing'],
  mobile_dev:        ['mobile developer','app developer','iOS','android','react native','flutter'],
  photography:       ['photographer','photography','product photos','real estate photos'],
  virtual_assistant: ['virtual assistant','VA','admin','executive assistant'],
};

function getSkill()    { return process.env.FREELANCE_SKILL || 'web_design'; }
function getKeywords() { return SKILL_KEYWORDS[getSkill()] || SKILL_KEYWORDS.web_design; }

function scoreIt(text) {
  let s = 55;
  const t = (text||'').toLowerCase();
  if (t.includes('urgent') || t.includes('asap'))       s += 18;
  if (t.includes('budget') || t.includes('$'))          s += 12;
  if (t.includes('hire') || t.includes('hiring'))       s += 8;
  if (t.includes('long term') || t.includes('ongoing')) s += 8;
  if (t.includes('fixed price') || t.includes('hourly'))s += 5;
  return Math.min(s, 99);
}

// ── PeoplePerHour (public RSS feed) ───────────────────────────────
async function scanPeoplePerHour() {
  const leads    = [];
  const keywords = getKeywords();
  const skill    = getSkill();

  const categoryMap = {
    web_design:        'websites-software',
    graphic_design:    'design',
    video_editing:     'video-photography-image',
    copywriting:       'writing-translation',
    social_media:      'digital-marketing',
    seo_marketing:     'digital-marketing',
    mobile_dev:        'websites-software',
    photography:       'video-photography-image',
    virtual_assistant: 'admin-secretarial',
  };

  const category = categoryMap[skill] || 'websites-software';

  try {
    logger.info('Scanning PeoplePerHour...');
    const { data } = await axios.get(
      `https://www.peopleperhour.com/hourlies?categoryUrl=${category}&sort=time`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 15000,
      }
    );

    const $ = cheerio.load(data);

    // Scrape job/project listings
    $('[class*="project"], [class*="job"], .listing, article').each((_, el) => {
      const title = $(el).find('h2,h3,h4,[class*="title"]').first().text().trim();
      const desc  = $(el).find('p,[class*="desc"]').first().text().trim();
      const link  = $(el).find('a').first().attr('href') || '';
      if (!title || title.length < 5) return;
      if (!keywords.some(kw => (title+' '+desc).toLowerCase().includes(kw.toLowerCase()))) return;

      leads.push({
        name        : `PPH: ${title.substring(0, 70)}`,
        description : desc.substring(0, 200) || title,
        source      : 'PeoplePerHour',
        source_url  : link.startsWith('http') ? link : `https://www.peopleperhour.com${link}`,
        industry    : category,
        budget_estimate: 'See post',
        score       : scoreIt(title + ' ' + desc),
      });
    });

    logger.info(`PeoplePerHour: ${leads.length} leads`);
  } catch (err) { logger.error(`PeoplePerHour: ${err.message}`); }
  return leads;
}

// ── Guru.com (public job board) ────────────────────────────────────
async function scanGuru() {
  const leads    = [];
  const keywords = getKeywords();
  const skill    = getSkill();

  const categoryMap = {
    web_design:        'web-development',
    graphic_design:    'design-art',
    video_editing:     'photo-video',
    copywriting:       'writing-translation',
    social_media:      'sales-marketing',
    seo_marketing:     'sales-marketing',
    mobile_dev:        'programming-development',
    photography:       'photo-video',
    virtual_assistant: 'admin-secretarial',
  };

  const cat = categoryMap[skill] || 'web-development';

  try {
    logger.info('Scanning Guru.com...');
    const { data } = await axios.get(
      `https://www.guru.com/jobs/${cat}/`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 15000,
      }
    );

    const $ = cheerio.load(data);

    $('.jobRecord, .job-record, [class*="job"], .serviceItem').each((_, el) => {
      const title  = $(el).find('h2,h3,[class*="title"]').first().text().trim();
      const desc   = $(el).find('p,[class*="desc"],[class*="detail"]').first().text().trim();
      const link   = $(el).find('a').first().attr('href') || '';
      const budget = $(el).find('[class*="budget"],[class*="price"]').first().text().trim();
      if (!title || title.length < 5) return;
      if (!keywords.some(kw => (title+' '+desc).toLowerCase().includes(kw.toLowerCase()))) return;

      leads.push({
        name        : `Guru: ${title.substring(0, 70)}`,
        description : desc.substring(0, 200) || title,
        source      : 'Guru.com',
        source_url  : link.startsWith('http') ? link : `https://www.guru.com${link}`,
        industry    : cat,
        budget_estimate: budget || 'See post',
        score       : scoreIt(title + ' ' + desc),
      });
    });

    logger.info(`Guru.com: ${leads.length} leads`);
  } catch (err) { logger.error(`Guru.com: ${err.message}`); }
  return leads;
}

// ── SimplyHired (public job search) ───────────────────────────────
async function scanSimplyHired() {
  const leads    = [];
  const keywords = getKeywords();
  const skill    = getSkill().replace(/_/g, ' ');

  try {
    logger.info('Scanning SimplyHired...');
    const query = encodeURIComponent(keywords[0] || 'freelancer');
    const { data } = await axios.get(
      `https://www.simplyhired.com/search?q=${query}&ftp=1`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 15000,
      }
    );

    const $ = cheerio.load(data);

    $('[data-testid="searchSerpJob"], .SerpJob, .jobposting, article[class*="job"]').each((_, el) => {
      const title   = $(el).find('h2,h3,[class*="title"]').first().text().trim();
      const company = $(el).find('[class*="company"]').first().text().trim();
      const desc    = $(el).find('p,[class*="desc"]').first().text().trim();
      const link    = $(el).find('a').first().attr('href') || '';
      if (!title) return;

      leads.push({
        name        : company || `SimplyHired: ${title.substring(0, 50)}`,
        description : `Hiring: ${title} — ${desc.substring(0, 150)}`,
        source      : 'SimplyHired',
        source_url  : link.startsWith('http') ? link : `https://www.simplyhired.com${link}`,
        industry    : skill,
        budget_estimate: 'See job post',
        score       : scoreIt(title + ' ' + desc),
      });
    });

    logger.info(`SimplyHired: ${leads.length} leads`);
  } catch (err) { logger.error(`SimplyHired: ${err.message}`); }
  return leads;
}

// ── Bark.com (local service marketplace) ─────────────────────────
async function scanBark() {
  const leads    = [];
  const keywords = getKeywords();
  const skill    = getSkill();

  const categoryMap = {
    web_design:        'web-design',
    graphic_design:    'graphic-design',
    video_editing:     'video-production',
    copywriting:       'copywriting',
    social_media:      'social-media-marketing',
    seo_marketing:     'seo',
    mobile_dev:        'app-development',
    photography:       'photography',
    virtual_assistant: 'virtual-assistant',
  };

  const cat = categoryMap[skill] || 'web-design';

  try {
    logger.info('Scanning Bark.com...');
    const { data } = await axios.get(
      `https://www.bark.com/en/us/${cat}/`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 15000,
      }
    );

    const $ = cheerio.load(data);

    $('[class*="profile"], [class*="seller"], [class*="provider"], .card').each((_, el) => {
      const name  = $(el).find('[class*="name"],h2,h3').first().text().trim();
      const desc  = $(el).find('[class*="desc"],p').first().text().trim();
      const link  = $(el).find('a').first().attr('href') || '';
      if (!name || name.length < 3) return;

      leads.push({
        name        : name.substring(0, 60),
        description : `Bark.com ${cat}: ${desc.substring(0, 180)}`,
        source      : 'Bark.com',
        source_url  : link.startsWith('http') ? link : `https://www.bark.com${link}`,
        industry    : cat,
        budget_estimate: 'Request quote',
        score       : scoreIt(name + ' ' + desc),
      });
    });

    logger.info(`Bark.com: ${leads.length} leads`);
  } catch (err) { logger.error(`Bark.com: ${err.message}`); }
  return leads;
}

// ── ProductHunt new launches ─────────────────────────────────────
async function scanProductHunt() {
  const leads = [];
  try {
    logger.info('Scanning ProductHunt...');
    // Public posts feed — no auth needed for basic access
    const { data } = await axios.get(
      'https://www.producthunt.com/feed',
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClientHunter/1.0)' },
        timeout: 12000,
      }
    );

    const $ = cheerio.load(data, { xmlMode: true });
    $('item').each((_, el) => {
      const title = $(el).find('title').text().trim();
      const desc  = $(el).find('description').text().replace(/<[^>]+>/g,'').trim();
      const link  = $(el).find('link').text().trim();
      if (!title) return;

      // Target early-stage products likely needing freelance help
      leads.push({
        name        : title.substring(0, 70),
        description : `ProductHunt launch: ${desc.substring(0, 200)}`,
        source      : 'ProductHunt',
        source_url  : link,
        industry    : 'Startup / SaaS',
        budget_estimate: 'Early stage startup',
        score       : 68,
      });
    });

    logger.info(`ProductHunt: ${leads.length} leads`);
  } catch (err) { logger.error(`ProductHunt: ${err.message}`); }
  return leads;
}

// ── IndieHackers (startup founders needing freelancers) ───────────
async function scanIndieHackers() {
  const leads    = [];
  const keywords = getKeywords();
  try {
    logger.info('Scanning IndieHackers...');
    const { data } = await axios.get(
      'https://www.indiehackers.com/jobs',
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 12000,
      }
    );

    const $ = cheerio.load(data);
    $('[class*="job"], article, .post').each((_, el) => {
      const title   = $(el).find('h2,h3,[class*="title"]').first().text().trim();
      const company = $(el).find('[class*="company"]').first().text().trim();
      const desc    = $(el).find('p').first().text().trim();
      const link    = $(el).find('a').first().attr('href') || '';
      if (!title || title.length < 5) return;
      if (!keywords.some(kw => (title+desc).toLowerCase().includes(kw.toLowerCase()))) return;

      leads.push({
        name        : company || `IH: ${title.substring(0, 50)}`,
        description : `IndieHackers: ${title} — ${desc.substring(0, 150)}`,
        source      : 'IndieHackers',
        source_url  : link.startsWith('http') ? link : `https://www.indiehackers.com${link}`,
        industry    : 'Indie / Startup',
        budget_estimate: 'See post',
        score       : scoreIt(title + desc),
      });
    });

    logger.info(`IndieHackers: ${leads.length} leads`);
  } catch (err) { logger.error(`IndieHackers: ${err.message}`); }
  return leads;
}

// ── Save to DB ────────────────────────────────────────────────────
async function saveLeads(leads) {
  let saved = 0;
  for (const l of leads) {
    try {
      const r = await run(
        `INSERT OR IGNORE INTO leads (name,description,source,source_url,industry,budget_estimate,score,status) VALUES(?,?,?,?,?,?,?,'New')`,
        [l.name,l.description,l.source,l.source_url,l.industry,l.budget_estimate,l.score]
      );
      if (r.changes > 0) saved++;
    } catch (e) { logger.error(`Save extra lead: ${e.message}`); }
  }
  return saved;
}

async function runExtraScan() {
  logger.info(`Extra sources scan (skill: ${getSkill()})...`);
  const results = await Promise.allSettled([
    scanPeoplePerHour(),
    scanGuru(),
    scanSimplyHired(),
    scanBark(),
    scanProductHunt(),
    scanIndieHackers(),
  ]);

  const [pph, guru, sh, bark, ph, ih] = results.map(r => r.value || []);
  const all = [...pph, ...guru, ...sh, ...bark, ...ph, ...ih];

  logger.info(`Extra sources — PPH:${pph.length} Guru:${guru.length} SimplyHired:${sh.length} Bark:${bark.length} PH:${ph.length} IH:${ih.length}`);

  const saved = await saveLeads(all);
  await run('INSERT INTO scan_logs(source,leads_found,status)VALUES(?,?,?)', ['extra_sources', saved, 'success']);
  logger.info(`Extra scan done: ${saved} new leads saved`);
  return { peoplePerHour: pph.length, guru: guru.length, simplyHired: sh.length, bark: bark.length, productHunt: ph.length, indieHackers: ih.length, total: all.length, saved };
}

module.exports = { runExtraScan };
