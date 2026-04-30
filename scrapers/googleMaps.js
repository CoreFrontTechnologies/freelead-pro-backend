/**
 * Google Maps / Places API Scanner
 * Fixed: relaxed filter — now saves ALL businesses found, scores higher if no website
 * Requires: GOOGLE_MAPS_API_KEY with billing enabled in Google Cloud Console
 */
const axios  = require('axios');
const { run, query } = require('../db/database');
const logger = require('../services/logger');

const PLACES_URL = 'https://maps.googleapis.com/maps/api/place';

function getApiKey() {
  if (!process.env.GOOGLE_MAPS_API_KEY) throw new Error('GOOGLE_MAPS_API_KEY not set in Railway Variables');
  return process.env.GOOGLE_MAPS_API_KEY;
}

function getCities() {
  if (process.env.SCAN_CITIES) return process.env.SCAN_CITIES.split(',').map(c => c.trim()).filter(Boolean);
  return ['Lagos Nigeria', 'Abuja Nigeria', 'London UK', 'New York USA'];
}

function getBusinessTypes() {
  if (process.env.SCAN_BUSINESS_TYPES) return process.env.SCAN_BUSINESS_TYPES.split(',').map(t => t.trim()).filter(Boolean);
  return ['restaurant', 'lawyer', 'dentist', 'real_estate_agency', 'beauty_salon', 'gym', 'plumber', 'contractor'];
}

function scoreBusiness(place) {
  let score = 60; // base score — all businesses are potential leads
  if (!place.website)                              score += 25; // no website = top priority
  if (place.website && isOldWebsite(place.website)) score += 12; // outdated site
  if ((place.rating || 0) >= 4.0)                  score += 8;  // established business
  if ((place.user_ratings_total || 0) > 50)        score += 6;
  if ((place.user_ratings_total || 0) > 200)       score += 5;
  return Math.min(score, 99);
}

function isOldWebsite(url) {
  if (!url) return false;
  return url.includes('wix.com') || url.includes('weebly.com') ||
         url.includes('jimdo.com') || url.includes('yolasite.com') ||
         url.includes('wordpress.com') || url.includes('blogspot.com');
}

async function searchPlaces(businessType, location) {
  const key   = getApiKey();
  const leads = [];

  try {
    // Step 1: Text search
    const searchRes = await axios.get(`${PLACES_URL}/textsearch/json`, {
      params: { query: `${businessType} in ${location}`, key },
      timeout: 15000,
    });

    if (searchRes.data.status === 'REQUEST_DENIED') {
      logger.error(`Maps REQUEST_DENIED: ${searchRes.data.error_message || 'Enable billing at console.cloud.google.com'}`);
      return [];
    }
    if (searchRes.data.status === 'ZERO_RESULTS') {
      logger.info(`Maps: no results for ${businessType} in ${location}`);
      return [];
    }

    const results = searchRes.data.results || [];
    logger.info(`Maps textsearch [${businessType}] in [${location}]: ${results.length} raw results`);

    for (const place of results.slice(0, 10)) {
      try {
        // Step 2: Get details
        const detailRes = await axios.get(`${PLACES_URL}/details/json`, {
          params: {
            place_id : place.place_id,
            fields   : 'name,formatted_address,website,rating,user_ratings_total,formatted_phone_number,permanently_closed',
            key,
          },
          timeout: 10000,
        });

        const d = detailRes.data.result || {};
        if (d.permanently_closed) continue;

        const hasNoWebsite   = !d.website;
        const hasOldWebsite  = isOldWebsite(d.website);
        const description    = hasNoWebsite
          ? `No website found — ${businessType} in ${location} (${d.user_ratings_total || 0} Google reviews)`
          : hasOldWebsite
            ? `Using outdated website builder — ${businessType} in ${location}`
            : `${businessType} in ${location} — potential client for web services`;

        leads.push({
          name            : d.name || place.name,
          description,
          source          : 'Google Maps',
          source_url      : `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
          email           : null,
          website         : d.website || null,
          industry        : businessType,
          budget_estimate : hasNoWebsite ? '$800–$3,000' : '$500–$2,000',
          score           : scoreBusiness(d),
          notes           : [
            d.formatted_phone_number ? `Phone: ${d.formatted_phone_number}` : null,
            d.formatted_address      ? `Address: ${d.formatted_address}` : null,
            d.rating                 ? `Rating: ${d.rating}/5 (${d.user_ratings_total} reviews)` : null,
            hasNoWebsite             ? '⭐ NO WEBSITE — High priority lead!' : null,
          ].filter(Boolean).join('\n'),
        });

        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        logger.warn(`Maps detail failed for ${place.name}: ${err.message}`);
      }
    }
  } catch (err) {
    const status = err.response?.data?.status;
    const msg    = err.response?.data?.error_message || err.message;
    logger.error(`Maps search [${businessType}] in [${location}]: ${status || ''} ${msg}`);
  }

  return leads;
}

async function saveLeads(leads) {
  let saved = 0;
  for (const l of leads) {
    try {
      const r = await run(
        `INSERT OR IGNORE INTO leads (name,description,source,source_url,email,website,industry,budget_estimate,score,status,notes) VALUES(?,?,?,?,?,?,?,?,?,'New',?)`,
        [l.name,l.description,l.source,l.source_url,l.email,l.website,l.industry,l.budget_estimate,l.score,l.notes||null]
      );
      if (r.changes > 0) saved++;
    } catch (e) { logger.error(`Save Maps lead: ${e.message}`); }
  }
  return saved;
}

async function runMapsScan(customCities, customTypes) {
  try { getApiKey(); } catch (err) {
    logger.warn('Skipping Maps: ' + err.message);
    return { skipped: true, reason: err.message };
  }

  const cities = customCities || getCities();
  const types  = customTypes  || getBusinessTypes();
  logger.info(`Starting Google Maps scan: ${cities.length} cities × ${types.length} business types`);

  const allLeads = [];
  for (const city of cities.slice(0, 3)) {
    for (const type of types.slice(0, 4)) {
      const found = await searchPlaces(type, city);
      allLeads.push(...found);
      logger.info(`Maps [${type}] in [${city}]: ${found.length} leads found`);
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const saved = await saveLeads(allLeads);
  await run('INSERT INTO scan_logs(source,leads_found,status)VALUES(?,?,?)', ['google_maps', saved, 'success']);
  logger.info(`Google Maps scan done: ${allLeads.length} found, ${saved} new saved`);
  return { total: allLeads.length, saved };
}

async function testMapsConnection() {
  try {
    const key = getApiKey();
    const res = await axios.get(`${PLACES_URL}/textsearch/json`, {
      params: { query: 'restaurant in London', key },
      timeout: 8000,
    });
    const status = res.data.status;
    if (status === 'OK' || status === 'ZERO_RESULTS') return { ok: true, status, results: res.data.results?.length || 0 };
    if (status === 'REQUEST_DENIED') return { ok: false, error: 'REQUEST_DENIED — Enable billing at console.cloud.google.com', message: res.data.error_message };
    return { ok: false, error: `API returned: ${status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { runMapsScan, testMapsConnection };
