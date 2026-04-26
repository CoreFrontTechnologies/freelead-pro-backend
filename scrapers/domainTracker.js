/**
 * Domain Expiry Tracker
 * Finds businesses whose domains are expiring soon — perfect outreach timing
 * Uses WHOIS lookup (no API key needed)
 */

const whois = require('whois');
const { run } = require('../db/database');
const logger = require('../services/logger');

// Sample domains to track — in production, feed these from your leads DB
// or a third-party list of expiring domains
const SAMPLE_DOMAINS_TO_TRACK = [
  'olddesignco.com',
  'smallbizsite.net',
  'localbakery2015.com'
];

const EXPIRY_THRESHOLD_DAYS = 30;

function parseDomainExpiry(whoisData) {
  const lines = whoisData.split('\n');
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      lower.includes('expir') ||
      lower.includes('expiry') ||
      lower.includes('renewal')
    ) {
      const match = line.match(/\d{4}-\d{2}-\d{2}/);
      if (match) return new Date(match[0]);

      const match2 = line.match(/\d{2}\/\d{2}\/\d{4}/);
      if (match2) {
        const [d, m, y] = match2[0].split('/');
        return new Date(`${y}-${m}-${d}`);
      }
    }
  }
  return null;
}

function daysUntilExpiry(expiryDate) {
  const now = new Date();
  const diff = expiryDate - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function lookupWhois(domain) {
  return new Promise((resolve, reject) => {
    whois.lookup(domain, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

async function checkDomain(domain) {
  try {
    const data = await lookupWhois(domain);
    const expiryDate = parseDomainExpiry(data);

    if (!expiryDate) {
      logger.warn(`Could not parse expiry for ${domain}`);
      return null;
    }

    const daysLeft = daysUntilExpiry(expiryDate);

    if (daysLeft > EXPIRY_THRESHOLD_DAYS) return null; // not urgent enough
    if (daysLeft < 0) return null; // already expired

    return {
      domain,
      expiryDate: expiryDate.toISOString().split('T')[0],
      daysLeft
    };
  } catch (err) {
    logger.error(`WHOIS failed for ${domain}: ${err.message}`);
    return null;
  }
}

async function getDomainsFromLeads() {
  const { query } = require('../db/database');
  try {
    const rows = await query(
      `SELECT website FROM leads WHERE website IS NOT NULL AND website != ''`
    );
    return rows
      .map(r => r.website)
      .map(url => url.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function runDomainScan(customDomains = []) {
  logger.info('Starting domain expiry scan...');

  const dbDomains = await getDomainsFromLeads();
  const allDomains = [
    ...new Set([...customDomains, ...dbDomains, ...SAMPLE_DOMAINS_TO_TRACK])
  ].slice(0, 20); // limit to 20 per run to avoid hammering WHOIS

  const results = [];

  for (const domain of allDomains) {
    const result = await checkDomain(domain);
    if (result) results.push(result);
    await new Promise(r => setTimeout(r, 1000)); // WHOIS rate limit
  }

  let saved = 0;
  for (const r of results) {
    try {
      await run(
        `INSERT OR IGNORE INTO leads
         (name, description, source, source_url, website, industry, budget_estimate, score, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'New')`,
        [
          r.domain,
          `Domain expiring in ${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'} (${r.expiryDate}) — great time to reach out`,
          'Domain Tracker',
          `https://${r.domain}`,
          r.domain,
          'Domain Expiry',
          '$800–$3,000',
          r.daysLeft <= 7 ? 95 : r.daysLeft <= 14 ? 88 : 80
        ]
      );
      saved++;
    } catch (err) {
      logger.error(`Failed to save domain lead: ${err.message}`);
    }
  }

  await run(
    'INSERT INTO scan_logs (source, leads_found, status) VALUES (?, ?, ?)',
    ['domain_tracker', saved, 'success']
  );

  logger.info(`Domain scan complete. ${saved} expiring domains found.`);
  return { checked: allDomains.length, expiring: results.length, saved };
}

module.exports = { runDomainScan };
