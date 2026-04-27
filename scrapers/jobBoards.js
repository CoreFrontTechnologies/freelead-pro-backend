/**
 * Job Board Scraper — NO API KEY REQUIRED
 * Adapts keywords based on FREELANCE_SKILL env var
 * Sources: RemoteOK, WeWorkRemotely, Freelancer.com
 */
const axios   = require('axios');
const cheerio = require('cheerio');
const { run } = require('../db/database');
const logger  = require('../services/logger');

// Keywords per skill — set FREELANCE_SKILL in Railway Variables
const SKILL_KEYWORDS = {
  web_design:     ['web design','web designer','website','landing page','wordpress','webflow','shopify','frontend','ui design','ux design','website redesign'],
  graphic_design: ['graphic design','graphic designer','logo design','branding','brand identity','illustrator','visual identity','creative design'],
  video_editing:  ['video editor','video editing','video production','youtube editor','motion graphics','videographer','reel editor','video content'],
  copywriting:    ['copywriter','content writer','blog writer','SEO writer','email copywriter','ghostwriter','technical writer','content creator'],
  social_media:   ['social media manager','social media marketing','instagram manager','facebook ads','community manager','social media strategist'],
  seo_marketing:  ['SEO specialist','digital marketer','SEO expert','Google ads','PPC specialist','marketing consultant','SEM','growth marketing'],
  mobile_dev:     ['mobile developer','app developer','iOS developer','android developer','react native','flutter','mobile app'],
  photography:    ['photographer','product photographer','real estate photographer','event photographer','videographer','commercial photography'],
  virtual_assistant: ['virtual assistant','VA','executive assistant','admin assistant','remote assistant','personal assistant'],
};

const DEFAULT_KEYWORDS = SKILL_KEYWORDS.web_design;

function getKeywords() {
  const skill = process.env.FREELANCE_SKILL || 'web_design';
  return SKILL_KEYWORDS[skill] || DEFAULT_KEYWORDS;
}

function matches(text) {
  const t = (text||'').toLowerCase();
  return getKeywords().some(k => t.includes(k.toLowerCase()));
}

function scoreIt(title, desc) {
  let s = 50;
  const t = ((title||'')+' '+(desc||'')).toLowerCase();
  if (t.includes('urgent') || t.includes('asap'))           s += 18;
  if (t.includes('budget') || t.includes('$'))              s += 12;
  if (t.includes('long term') || t.includes('ongoing'))     s += 10;
  if (t.includes('e-commerce') || t.includes('ecommerce'))  s += 8;
  if (t.includes('redesign') || t.includes('revamp'))       s += 8;
  if (t.includes('full') || t.includes('complete'))         s += 6;
  return Math.min(s, 99);
}

async function scrapeRemoteOK() {
  const leads = [];
  try {
    logger.info('Scanning RemoteOK...');
    const { data } = await axios.get('https://remoteok.com/api', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClientHunter/1.0)' },
      timeout: 15000,
    });
    const jobs = Array.isArray(data) ? data.slice(1, 60) : [];
    for (const job of jobs) {
      const title = job.position || '';
      const desc  = (job.description||'').replace(/<[^>]+>/g,'');
      if (!matches(title+' '+desc)) continue;
      leads.push({
        name: job.company || 'Company on RemoteOK',
        description: `Hiring: ${title} — ${desc.substring(0,180)}`,
        source: 'RemoteOK', source_url: job.url || 'https://remoteok.com',
        industry: (job.tags||[])[0] || 'Remote',
        budget_estimate: job.salary || 'Negotiable',
        score: scoreIt(title, desc),
      });
    }
    logger.info(`RemoteOK: ${leads.length} leads`);
  } catch (err) { logger.error(`RemoteOK: ${err.message}`); }
  return leads;
}

async function scrapeWeWorkRemotely() {
  const leads = [];
  try {
    logger.info('Scanning WeWorkRemotely...');
    const skill = process.env.FREELANCE_SKILL || 'web_design';
    const category = skill.includes('video') ? 'remote-design-jobs' :
                     skill.includes('copywriting') ? 'remote-writing-jobs' :
                     skill.includes('seo') ? 'remote-marketing-jobs' :
                     skill.includes('mobile') ? 'remote-programming-jobs' :
                     'remote-design-jobs';

    const { data } = await axios.get(`https://weworkremotely.com/categories/${category}.rss`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClientHunter/1.0)' },
      timeout: 15000,
    });
    const $ = cheerio.load(data, { xmlMode: true });
    $('item').each((_, el) => {
      const title = $(el).find('title').text().replace(/\<\!\[CDATA\[|\]\]\>/g,'').trim();
      const desc  = $(el).find('description').text().replace(/<[^>]+>/g,'').trim();
      const link  = $(el).find('link').text().trim();
      if (!matches(title+' '+desc)) return;
      const parts = title.split(':');
      leads.push({
        name: parts[0]?.trim() || 'Company',
        description: `Hiring: ${parts.slice(1).join(':').trim() || title}`,
        source: 'WeWorkRemotely', source_url: link,
        industry: 'Remote', budget_estimate: 'Negotiable',
        score: scoreIt(title, desc),
      });
    });
    logger.info(`WeWorkRemotely: ${leads.length} leads`);
  } catch (err) { logger.error(`WeWorkRemotely: ${err.message}`); }
  return leads;
}

async function scrapeFreelancer() {
  const leads = [];
  try {
    logger.info('Scanning Freelancer.com...');
    const { data } = await axios.get(
      'https://www.freelancer.com/api/projects/0.1/projects/active/?limit=25&job_details=true',
      { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }
    );
    const projects = data?.result?.projects || [];
    for (const p of projects) {
      const title = p.title || '';
      const desc  = p.preview_description || '';
      if (!matches(title+' '+desc)) continue;
      const budget = p.budget ? `$${p.budget.minimum}–$${p.budget.maximum}` : 'Negotiable';
      leads.push({
        name: 'Client on Freelancer.com',
        description: `${title} — ${desc.substring(0,180)}`,
        source: 'Freelancer.com',
        source_url: `https://www.freelancer.com/projects/${p.seo_url||p.id}`,
        industry: 'Freelance Project', budget_estimate: budget,
        score: scoreIt(title, desc),
      });
    }
    logger.info(`Freelancer.com: ${leads.length} leads`);
  } catch (err) { logger.error(`Freelancer.com: ${err.message}`); }
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
    } catch (e) { logger.error(`Save: ${e.message}`); }
  }
  return saved;
}

async function runJobBoardScan() {
  logger.info(`Job board scan (skill: ${process.env.FREELANCE_SKILL||'web_design'})...`);
  const results = await Promise.allSettled([scrapeRemoteOK(), scrapeWeWorkRemotely(), scrapeFreelancer()]);
  const all = results.flatMap(r => r.value || []);
  const saved = await saveLeads(all);
  await run('INSERT INTO scan_logs(source,leads_found,status)VALUES(?,?,?)',['job_boards',saved,'success']);
  logger.info(`Job boards done: ${saved} saved`);
  return { total: all.length, saved };
}

module.exports = { runJobBoardScan };
