/**
 * Google Custom Search Scanner
 * Requires: GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX in Railway Variables
 * 
 * Setup (free 100 searches/day):
 * 1. console.cloud.google.com → APIs & Services → Enable "Custom Search API"
 * 2. programmablesearchengine.google.com → Create → Search the entire web → copy ID → GOOGLE_SEARCH_CX
 * 3. console.cloud.google.com → Credentials → Create API Key → GOOGLE_SEARCH_API_KEY
 */
const axios  = require('axios');
const { run } = require('../db/database');
const logger  = require('../services/logger');

const SKILL_QUERIES = {
  web_design:        ['need web designer hire','website redesign freelancer','no website local business contact','looking for web developer 2025','build website small business'],
  graphic_design:    ['need graphic designer hire','logo design freelancer','branding designer needed','looking for brand designer'],
  video_editing:     ['need video editor hire','youtube editor freelancer','video production help needed','looking for video editor'],
  copywriting:       ['need copywriter hire','content writer freelancer','blog writer needed','SEO writer looking for'],
  social_media:      ['need social media manager','instagram manager freelancer','social media help small business'],
  seo_marketing:     ['need SEO expert hire','digital marketing freelancer','Google ads help needed'],
  mobile_dev:        ['need app developer hire','mobile app freelancer','iOS android developer needed'],
  photography:       ['need photographer hire','product photography freelancer','real estate photographer needed'],
  virtual_assistant: ['need virtual assistant hire','VA freelancer','admin assistant remote needed'],
};

function getSkill() { return process.env.FREELANCE_SKILL || 'web_design'; }
function getQueries() { return (SKILL_QUERIES[getSkill()] || SKILL_QUERIES.web_design).slice(0, 5); }

function scoreResult(title, snippet) {
  let s = 58;
  const t = ((title||'') + ' ' + (snippet||'')).toLowerCase();
  if (t.includes('urgent') || t.includes('asap'))   s += 15;
  if (t.includes('hire') || t.includes('hiring'))   s += 12;
  if (t.includes('budget') || t.includes('pay'))    s += 10;
  if (t.includes('no website') || t.includes('need website')) s += 15;
  if (t.includes('small business') || t.includes('local'))    s += 6;
  return Math.min(s, 99);
}

async function runGoogleSearchScan() {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx  = process.env.GOOGLE_SEARCH_CX;

  if (!key || !cx) {
    logger.warn('Google Search skipped: GOOGLE_SEARCH_API_KEY or GOOGLE_SEARCH_CX not set');
    return { skipped: true, reason: 'Add GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX in Railway Variables. Enable "Custom Search API" at console.cloud.google.com' };
  }

  logger.info(`Starting Google Search scan (skill: ${getSkill()})...`);
  const leads = [];

  for (const q of getQueries()) {
    try {
      const { data } = await axios.get('https://www.googleapis.com/customsearch/v1', {
        params: { key, cx, q, num: 10 },
        timeout: 12000,
      });

      if (data.error) {
        logger.error(`Google Search API error: ${data.error.message}`);
        if (data.error.code === 403) {
          logger.error('403 from Google Search — Make sure "Custom Search API" is enabled at console.cloud.google.com → APIs & Services → Library');
        }
        break;
      }

      for (const item of (data.items || [])) {
        let domain = '';
        try { domain = new URL(item.link).hostname.replace('www.', ''); } catch(e) {}
        leads.push({
          name        : item.pagemap?.organization?.[0]?.name || item.title?.split('|')[0]?.trim().substring(0,60) || domain,
          description : `Google Search: "${q}" — ${(item.snippet||'').substring(0,200)}`,
          source      : 'Google Search',
          source_url  : item.link,
          website     : domain,
          industry    : 'Google Discovery',
          budget_estimate: 'Unknown — reach out to qualify',
          score       : scoreResult(item.title, item.snippet),
        });
      }
      logger.info(`Google Search "${q}": ${(data.items||[]).length} results`);
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      logger.error(`Google Search "${q}": ${err.response?.status} ${err.message}`);
      if (err.response?.status === 403) {
        logger.error('Fix: Go to console.cloud.google.com → APIs & Services → Library → search "Custom Search API" → Enable it');
        break;
      }
    }
  }

  let saved = 0;
  for (const l of leads) {
    try {
      const r = await run(
        `INSERT OR IGNORE INTO leads (name,description,source,source_url,website,industry,budget_estimate,score,status) VALUES(?,?,?,?,?,?,?,?,'New')`,
        [l.name,l.description,l.source,l.source_url,l.website,l.industry,l.budget_estimate,l.score]
      );
      if (r.changes > 0) saved++;
    } catch(e) { logger.error(`Save Google Search lead: ${e.message}`); }
  }

  await run('INSERT INTO scan_logs(source,leads_found,status)VALUES(?,?,?)', ['google_search', saved, 'success']);
  logger.info(`Google Search done: ${leads.length} found, ${saved} saved`);
  return { total: leads.length, saved };
}

async function testGoogleSearchConnection() {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx  = process.env.GOOGLE_SEARCH_CX;
  if (!key) return { ok: false, error: 'GOOGLE_SEARCH_API_KEY not set' };
  if (!cx)  return { ok: false, error: 'GOOGLE_SEARCH_CX not set' };
  try {
    const { data } = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: { key, cx, q: 'web designer', num: 1 }, timeout: 8000,
    });
    if (data.error) return { ok: false, error: data.error.message, code: data.error.code };
    return { ok: true, results: data.items?.length || 0 };
  } catch (err) {
    if (err.response?.status === 403) return { ok: false, error: 'Custom Search API not enabled. Go to console.cloud.google.com → APIs & Services → Enable "Custom Search API"' };
    return { ok: false, error: err.message };
  }
}

module.exports = { runGoogleSearchScan, testGoogleSearchConnection };
