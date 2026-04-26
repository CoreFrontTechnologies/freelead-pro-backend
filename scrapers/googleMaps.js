/**
 * Google Maps / Places API Scanner
 * Finds local businesses with no website or outdated site
 * Requires: GOOGLE_MAPS_API_KEY in environment variables
 */

const axios  = require('axios');
const { run } = require('../db/database');
const logger  = require('../services/logger');

const PLACES_URL = 'https://maps.googleapis.com/maps/api/place';

function getApiKey() {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY not set. Add it in Railway → Variables.');
  }
  return process.env.GOOGLE_MAPS_API_KEY;
}

// Read cities and business types from env (or use defaults)
function getCities() {
  if (process.env.SCAN_CITIES) {
    return process.env.SCAN_CITIES.split(',').map(c => c.trim()).filter(Boolean);
  }
  return ['Lagos Nigeria', 'Abuja Nigeria', 'London UK', 'New York USA'];
}

function getBusinessTypes() {
  if (process.env.SCAN_BUSINESS_TYPES) {
    return process.env.SCAN_BUSINESS_TYPES.split(',').map(t => t.trim()).filter(Boolean);
  }
  return ['restaurant', 'lawyer', 'dentist', 'real_estate_agency', 'beauty_salon', 'gym', 'plumber'];
}

function scoreLead(place) {
  let score = 55;
  if (!place.website)                              score += 25; // no website = top priority
  if (place.rating && place.rating < 3.5)          score += 8;  // low rating = room to improve
  if ((place.user_ratings_total || 0) > 50)        score += 8;  // established business
  if ((place.user_ratings_total || 0) > 200)       score += 5;  // very established
  if (!place.permanently_closed)                   score += 4;
  return Math.min(score, 99);
}

// Search Google Places for businesses in a location
async function searchPlaces(businessType, location) {
  const key = getApiKey();
  const leads = [];

  try {
    // Text search
    const searchRes = await axios.get(`${PLACES_URL}/textsearch/json`, {
      params : {
        query : `${businessType} in ${location}`,
        key,
      },
      timeout : 10000,
    });

    const results = searchRes.data.results || [];

    for (const place of results.slice(0, 8)) {
      // Get full details for each place
      const detailRes = await axios.get(`${PLACES_URL}/details/json`, {
        params : {
          place_id : place.place_id,
          fields   : 'name,formatted_address,website,rating,user_ratings_total,formatted_phone_number,permanently_closed',
          key,
        },
        timeout : 10000,
      });

      const d = detailRes.data.result || {};

      // Only include businesses with no website or an obviously outdated one
      const noWebsite   = !d.website;
      const oldBuilder  = d.website && (
        d.website.includes('wix.com') ||
        d.website.includes('weebly.com') ||
        d.website.includes('yolasite.com') ||
        d.website.includes('jimdo.com')
      );

      if (!noWebsite && !oldBuilder) continue;

      leads.push({
        name        : d.name || place.name,
        description : noWebsite
          ? `No website — local ${businessType} found via Google Maps in ${location}`
          : `Using outdated website builder (${d.website}) — found via Google Maps`,
        source      : 'Google Maps',
        source_url  : `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
        email       : null,
        website     : d.website || null,
        industry    : businessType,
        budget_estimate : '$800–$2,500',
        score       : scoreLead(d),
        notes       : [
          d.formatted_phone_number ? `Phone: ${d.formatted_phone_number}` : null,
          d.formatted_address ? `Address: ${d.formatted_address}` : null,
          d.rating ? `Rating: ${d.rating}/5 (${d.user_ratings_total} reviews)` : null,
        ].filter(Boolean).join('\n'),
      });

      await new Promise(r => setTimeout(r, 250)); // respect rate limits
    }
  } catch (err) {
    logger.error(`Maps search failed [${businessType} in ${location}]: ${err.message}`);
  }

  return leads;
}

async function saveLeads(leads) {
  let saved = 0;
  for (const lead of leads) {
    try {
      const result = await run(
        `INSERT OR IGNORE INTO leads
         (name, description, source, source_url, email, website, industry, budget_estimate, score, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'New', ?)`,
        [lead.name, lead.description, lead.source, lead.source_url,
         lead.email, lead.website, lead.industry, lead.budget_estimate, lead.score, lead.notes]
      );
      if (result.changes > 0) saved++;
    } catch (err) {
      logger.error(`Failed to save Maps lead: ${err.message}`);
    }
  }
  return saved;
}

async function runMapsScan(customCities, customTypes) {
  try { getApiKey(); } catch (err) {
    logger.warn('Skipping Google Maps scan: ' + err.message);
    return { skipped: true, reason: err.message };
  }

  const cities = customCities || getCities();
  const types  = customTypes  || getBusinessTypes();

  logger.info(`Starting Google Maps scan: ${cities.length} cities × ${types.length} business types`);

  const allLeads = [];

  // Limit per run to avoid burning API quota
  for (const city of cities.slice(0, 3)) {
    for (const type of types.slice(0, 3)) {
      const leads = await searchPlaces(type, city);
      allLeads.push(...leads);
      logger.info(`Maps: ${leads.length} leads found for [${type}] in [${city}]`);
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const saved = await saveLeads(allLeads);

  await run(
    'INSERT INTO scan_logs (source, leads_found, status) VALUES (?, ?, ?)',
    ['google_maps', saved, 'success']
  );

  logger.info(`Google Maps scan complete. ${saved} leads saved.`);
  return { total: allLeads.length, saved };
}

// Test connection
async function testMapsConnection() {
  try {
    const key = getApiKey();
    const res = await axios.get(`${PLACES_URL}/textsearch/json`, {
      params : { query: 'restaurant in London', key },
      timeout : 8000,
    });
    const status = res.data.status;
    if (status === 'OK' || status === 'ZERO_RESULTS') {
      return { ok: true, status };
    }
    return { ok: false, error: `API returned: ${status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { runMapsScan, testMapsConnection };
