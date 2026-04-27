/**
 * Domain Expiry Tracker — NO API KEY REQUIRED
 * Uses WHOIS to find businesses whose domains are about to expire
 */
const { run, query } = require('../db/database');
const logger = require('../services/logger');

// Simple WHOIS via HTTP (no npm package needed, avoids native dep issues)
const axios = require('axios');

async function checkDomainExpiry(domain) {
  try {
    // Use a free WHOIS REST API
    const { data } = await axios.get(`https://whois.freeaiapi.xyz/?name=${domain}`, {
      timeout: 8000,
      headers: { 'User-Agent': 'ClientHunter/1.0' }
    });

    const expiry = data?.expiry_date || data?.expiration_date || null;
    if (!expiry) return null;

    const expiryDate = new Date(expiry);
    const now = new Date();
    const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

    if (daysLeft < 0 || daysLeft > 60) return null; // expired or too far out

    return { domain, expiryDate: expiryDate.toISOString().split('T')[0], daysLeft };
  } catch (err) {
    // Try alternate WHOIS API
    try {
      const { data } = await axios.get(`https://api.whoisfreaks.com/v1.0/whois?whois=live&domainName=${domain}`, {
        timeout: 8000,
      });
      const expiry = data?.registrar_registration_expiration_date;
      if (!expiry) return null;
      const expiryDate = new Date(expiry);
      const daysLeft = Math.ceil((expiryDate - new Date()) / (1000*60*60*24));
      if (daysLeft < 0 || daysLeft > 60) return null;
      return { domain, expiryDate: expiryDate.toISOString().split('T')[0], daysLeft };
    } catch { return null; }
  }
}

async function runDomainScan(customDomains = []) {
  logger.info('Starting domain expiry scan...');

  // Get websites from existing leads in DB
  let dbDomains = [];
  try {
    const rows = await query(`SELECT website FROM leads WHERE website IS NOT NULL AND website != '' LIMIT 30`);
    dbDomains = rows.map(r => r.website.replace(/^https?:\/\//,'').replace(/\/.*/,'').trim()).filter(Boolean);
  } catch(e) {}

  const allDomains = [...new Set([...customDomains, ...dbDomains])].slice(0, 15);

  if (allDomains.length === 0) {
    logger.info('No domains to check');
    return { checked: 0, expiring: 0, saved: 0 };
  }

  const expiring = [];
  for (const domain of allDomains) {
    const result = await checkDomainExpiry(domain);
    if (result) expiring.push(result);
    await new Promise(r => setTimeout(r, 800));
  }

  let saved = 0;
  for (const r of expiring) {
    try {
      const res = await run(
        `INSERT OR IGNORE INTO leads (name,description,source,source_url,website,industry,budget_estimate,score,status)
         VALUES(?,?,?,?,?,?,?,?,'New')`,
        [
          r.domain,
          `Domain expiring in ${r.daysLeft} day${r.daysLeft===1?'':'s'} (${r.expiryDate}) — great time to reach out about a website refresh`,
          'Domain Tracker',
          `https://${r.domain}`,
          r.domain, 'Domain Expiry', '$800–$3,000',
          r.daysLeft <= 7 ? 96 : r.daysLeft <= 14 ? 90 : r.daysLeft <= 30 ? 83 : 75,
        ]
      );
      if (res.changes > 0) saved++;
    } catch(e) { logger.error(`Domain save failed: ${e.message}`); }
  }

  await run('INSERT INTO scan_logs(source,leads_found,status)VALUES(?,?,?)',['domain_tracker',saved,'success']);
  logger.info(`Domain scan done: ${expiring.length} expiring, ${saved} saved`);
  return { checked: allDomains.length, expiring: expiring.length, saved };
}

module.exports = { runDomainScan };
