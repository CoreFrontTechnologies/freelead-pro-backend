/**
 * Google Search Scraper
 * Uses Google Custom Search API to find businesses needing web design
 * 
 * Setup (free - 100 searches/day):
 * 1. Go to: https://console.cloud.google.com
 * 2. Enable "Custom Search API"
 * 3. Go to: https://programmablesearchengine.google.com
 * 4. Create a search engine → set to "Search the entire web"
 * 5. Copy the "Search engine ID" (cx) → add as GOOGLE_SEARCH_CX in Railway
 * 6. In Cloud Console → Credentials → API Key → add as GOOGLE_SEARCH_API_KEY
 */

const axios  = require('axios');
const { run } = require('../db/database');
const logger  = require('../services/logger');

const SEARCH_QUERIES = [
  'local business "no website" contact',
  'small business "we don\'t have a website yet"',
  '"looking for web designer" hire 2024',
  '"need a website" small business',
  '"website redesign" "looking for" freelancer',
  'restaurant "get a website" 2024',
  '"our website is outdated" contact us',
  'law firm "no website" services',
  '"need help with website" business',
  'dentist clinic "contact us" site:yelp.com no website',
];

function scoreResult(title, snippet) {
  let s = 55;
  const t = ((title||'')+ ' ' +(snippet||'')).toLowerCase();
  if (t.includes('urgent') || t.includes('asap'))           s += 15;
  if (t.includes('hire') || t.includes('looking for'))      s += 12;
  if (t.includes('no website') || t.includes('no web'))     s += 18;
  if (t.includes('outdated') || t.includes('old website'))  s += 12;
  if (t.includes('budget') || t.includes('pay'))            s += 8;
  if (t.includes('small business') || t.includes('local'))  s += 6;
  return Math.min(s, 99);
}

async function searchGoogle(query) {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx  = process.env.GOOGLE_SEARCH_CX;

  if (!key || !cx) {
    throw new Error('GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX not set in Railway Variables');
  }

  const { data } = await axios.get('https://www.googleapis.com/customsearch/v1', {
    params: { key, cx, q: query, num: 10 },
    timeout: 12000,
  });

  return data.items || [];
}

async function runGoogleSearchScan() {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx  = process.env.GOOGLE_SEARCH_CX;

  if (!key || !cx) {
    logger.warn('Skipping Google Search scan: GOOGLE_SEARCH_API_KEY or GOOGLE_SEARCH_CX not set');
    return { skipped: true, reason: 'Set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX in Railway Variables. Free at console.cloud.google.com' };
  }

  logger.info('Starting Google Search scan...');
  const allResults = [];

  // Run 5 queries per scan to stay within free tier (100/day)
  for (const query of SEARCH_QUERIES.slice(0, 5)) {
    try {
      const items = await searchGoogle(query);
      for (const item of items) {
        const domain = item.link ? new URL(item.link).hostname.replace('www.','') : '';
        allResults.push({
          name            : item.pagemap?.organization?.[0]?.name || item.pagemap?.hcard?.[0]?.fn || domain || 'Business',
          description     : `Google search: "${query}" — ${(item.snippet||'').substring(0,200)}`,
          source          : 'Google Search',
          source_url      : item.link,
          website         : domain,
          industry        : 'Google Discovery',
          budget_estimate : 'Unknown — qualify via outreach',
          score           : scoreResult(item.title, item.snippet),
        });
      }
      logger.info(`Google Search: "${query}" → ${items.length} results`);
      await new Promise(r => setTimeout(r, 1000)); // rate limit
    } catch (err) {
      logger.error(`Google search failed for "${query}": ${err.message}`);
    }
  }

  let saved = 0;
  for (const l of allResults) {
    try {
      const r = await run(
        `INSERT OR IGNORE INTO leads (name,description,source,source_url,website,industry,budget_estimate,score,status) VALUES(?,?,?,?,?,?,?,?,'New')`,
        [l.name,l.description,l.source,l.source_url,l.website,l.industry,l.budget_estimate,l.score]
      );
      if (r.changes > 0) saved++;
    } catch(e) { logger.error(`Google search save: ${e.message}`); }
  }

  await run('INSERT INTO scan_logs(source,leads_found,status)VALUES(?,?,?)',['google_search',saved,'success']);
  logger.info(`Google Search done: ${saved} leads saved`);
  return { total: allResults.length, saved };
}

async function testGoogleSearchConnection() {
  try {
    const items = await searchGoogle('web designer for hire');
    return { ok: true, results: items.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { runGoogleSearchScan, testGoogleSearchConnection };
