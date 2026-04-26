/**
 * Job Board Scraper
 * Scrapes: RemoteOK (public API), We Work Remotely, Freelancer listings
 * Note: Upwork requires OAuth — instructions in README
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { run } = require('../db/database');
const logger = require('../services/logger');

const WEB_DESIGN_KEYWORDS = [
  'web design', 'web designer', 'website design', 'landing page',
  'wordpress', 'webflow', 'shopify', 'ui design', 'frontend',
  'website redesign', 'website developer', 'web developer'
];

function matchesKeywords(text) {
  const lower = text.toLowerCase();
  return WEB_DESIGN_KEYWORDS.some(kw => lower.includes(kw));
}

function scoreJobLead(job) {
  let score = 50;
  const text = `${job.name} ${job.description}`.toLowerCase();

  if (text.includes('urgent') || text.includes('asap')) score += 15;
  if (text.includes('budget') || text.includes('$') || text.includes('pay')) score += 10;
  if (text.includes('long term') || text.includes('ongoing')) score += 10;
  if (text.includes('redesign')) score += 8;
  if (text.includes('e-commerce') || text.includes('ecommerce')) score += 8;
  if (text.includes('shopify') || text.includes('webflow')) score += 5;
  if (text.includes('full website')) score += 5;

  return Math.min(score, 99);
}

// ── RemoteOK (has a public JSON API) ────────────────────────────
async function scrapeRemoteOK() {
  const leads = [];
  try {
    const { data } = await axios.get('https://remoteok.com/api', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FreeleadPro/1.0)' },
      timeout: 10000
    });

    const jobs = Array.isArray(data) ? data.slice(1) : [];

    for (const job of jobs) {
      const title = job.position || '';
      const desc = job.description || '';

      if (!matchesKeywords(title + ' ' + desc)) continue;

      leads.push({
        name: job.company || 'Unknown Company',
        description: `${title} — ${desc.substring(0, 200)}`,
        source: 'RemoteOK',
        source_url: job.url || 'https://remoteok.com',
        industry: job.tags ? job.tags[0] : 'Remote',
        budget_estimate: job.salary || 'Negotiable',
        score: scoreJobLead({ name: title, description: desc })
      });
    }

    logger.info(`RemoteOK: found ${leads.length} web design leads`);
  } catch (err) {
    logger.error(`RemoteOK scrape failed: ${err.message}`);
  }
  return leads;
}

// ── We Work Remotely ─────────────────────────────────────────────
async function scrapeWeWorkRemotely() {
  const leads = [];
  try {
    const { data } = await axios.get(
      'https://weworkremotely.com/categories/remote-design-jobs.rss',
      { timeout: 10000 }
    );

    const $ = cheerio.load(data, { xmlMode: true });

    $('item').each((_, el) => {
      const title = $(el).find('title').text();
      const desc = $(el).find('description').text().replace(/<[^>]+>/g, '');
      const link = $(el).find('link').text();

      if (!matchesKeywords(title + ' ' + desc)) return;

      const company = title.split(':')[0]?.trim() || 'Unknown';
      const role = title.split(':')[1]?.trim() || title;

      leads.push({
        name: company,
        description: `${role} — ${desc.substring(0, 200)}`,
        source: 'WeWorkRemotely',
        source_url: link,
        industry: 'Remote / Design',
        budget_estimate: 'Negotiable',
        score: scoreJobLead({ name: title, description: desc })
      });
    });

    logger.info(`WeWorkRemotely: found ${leads.length} leads`);
  } catch (err) {
    logger.error(`WeWorkRemotely scrape failed: ${err.message}`);
  }
  return leads;
}

// ── LinkedIn Jobs (via axios + cheerio public scrape) ─────────────
async function scrapeLinkedIn() {
  const leads = [];
  try {
    const keywords = encodeURIComponent('web designer');
    const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${keywords}&location=&start=0`;

    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const $ = cheerio.load(data);

    $('li').each((_, el) => {
      const title = $(el).find('.base-search-card__title').text().trim();
      const company = $(el).find('.base-search-card__subtitle').text().trim();
      const link = $(el).find('a').attr('href') || '';

      if (!title || !company) return;
      if (!matchesKeywords(title)) return;

      leads.push({
        name: company,
        description: `Hiring: ${title}`,
        source: 'LinkedIn',
        source_url: link,
        industry: 'Business',
        budget_estimate: 'Negotiable',
        score: scoreJobLead({ name: title, description: company })
      });
    });

    logger.info(`LinkedIn: found ${leads.length} leads`);
  } catch (err) {
    logger.error(`LinkedIn scrape failed: ${err.message}`);
  }
  return leads;
}

// ── Save leads to DB (deduplicate by source_url) ─────────────────
async function saveLeads(leads) {
  let saved = 0;
  for (const lead of leads) {
    try {
      await run(
        `INSERT OR IGNORE INTO leads (name, description, source, source_url, industry, budget_estimate, score, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'New')`,
        [lead.name, lead.description, lead.source, lead.source_url,
         lead.industry, lead.budget_estimate, lead.score]
      );
      saved++;
    } catch (err) {
      logger.error(`Failed to save lead: ${err.message}`);
    }
  }
  return saved;
}

async function runJobBoardScan() {
  logger.info('Starting job board scan...');
  const [remote, wwr, linkedin] = await Promise.all([
    scrapeRemoteOK(),
    scrapeWeWorkRemotely(),
    scrapeLinkedIn()
  ]);

  const all = [...remote, ...wwr, ...linkedin];
  const saved = await saveLeads(all);

  await run(
    'INSERT INTO scan_logs (source, leads_found, status) VALUES (?, ?, ?)',
    ['job_boards', saved, 'success']
  );

  logger.info(`Job board scan complete. ${saved} leads saved.`);
  return { total: all.length, saved };
}

module.exports = { runJobBoardScan };
