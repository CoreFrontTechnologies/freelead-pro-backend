/**
 * API Test Routes with detailed diagnostics
 * GET /api/test/all      → test all at once
 * GET /api/test/ai       → test AI provider
 * GET /api/test/email    → test Gmail
 * GET /api/test/maps     → test Google Maps
 * GET /api/test/twitter  → test Twitter
 * GET /api/test/reddit   → test Reddit
 * GET /api/logs          → recent scan logs + errors
 */
const express = require('express');
const router  = express.Router();
const logger  = require('../services/logger');

async function safeTest(name, fn) {
  try {
    const result = await fn();
    logger.info(`Test ${name}: ${result.ok ? 'PASS' : 'FAIL'} — ${JSON.stringify(result)}`);
    return result;
  } catch (err) {
    logger.error(`Test ${name} threw: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// GET /api/test/all
router.get('/all', async (req, res) => {
  logger.info('Running full API test...');
  const results = {};

  results.ai = await safeTest('ai', async () => {
    const { testAIConnection } = require('../services/aiEmail');
    return testAIConnection();
  });

  results.gmail = await safeTest('gmail', async () => {
    const { verifyEmailConfig } = require('../services/emailSender');
    return verifyEmailConfig();
  });

  results.googleMaps = await safeTest('googleMaps', async () => {
    const { testMapsConnection } = require('../scrapers/googleMaps');
    return testMapsConnection();
  });

  results.twitter = await safeTest('twitter', async () => {
    const { testTwitterConnection } = require('../scrapers/socialMedia');
    return testTwitterConnection();
  });

  results.reddit = await safeTest('reddit', async () => {
    const axios = require('axios');
    const { data } = await axios.get('https://www.reddit.com/r/Entrepreneur/new.json?limit=1&raw_json=1', {
      headers: { 'User-Agent': 'ClientHunter/1.0 (contact@clienthunter.io)', 'Accept': 'application/json' },
      timeout: 10000,
    });
    const ok = !!data?.data?.children;
    return { ok, posts: data?.data?.children?.length || 0, note: 'No API key required' };
  });

  results.jobBoards = await safeTest('jobBoards', async () => {
    const axios = require('axios');
    const { data } = await axios.get('https://remoteok.com/api', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClientHunter/1.0)' },
      timeout: 10000,
    });
    const ok = Array.isArray(data) && data.length > 0;
    return { ok, jobs: data.length - 1, note: 'No API key required' };
  });

  const allOk = Object.values(results).every(r => r.ok);
  const summary = Object.entries(results).map(([k,v]) => `${k}: ${v.ok ? '✅' : '❌'}`).join(', ');
  logger.info(`Test summary: ${summary}`);

  res.json({ allOk, summary, results });
});

router.get('/ai', async (req, res) => {
  const result = await safeTest('ai', async () => {
    const { testAIConnection } = require('../services/aiEmail');
    return testAIConnection();
  });
  res.json(result);
});

router.get('/email', async (req, res) => {
  const result = await safeTest('email', async () => {
    const { verifyEmailConfig } = require('../services/emailSender');
    return verifyEmailConfig();
  });
  res.json(result);
});

router.get('/maps', async (req, res) => {
  const result = await safeTest('maps', async () => {
    const { testMapsConnection } = require('../scrapers/googleMaps');
    return testMapsConnection();
  });
  res.json(result);
});

router.get('/twitter', async (req, res) => {
  const result = await safeTest('twitter', async () => {
    const { testTwitterConnection } = require('../scrapers/socialMedia');
    return testTwitterConnection();
  });
  res.json(result);
});

router.get('/reddit', async (req, res) => {
  const result = await safeTest('reddit', async () => {
    const axios = require('axios');
    const { data } = await axios.get('https://www.reddit.com/r/Entrepreneur/new.json?limit=3&raw_json=1', {
      headers: { 'User-Agent': 'ClientHunter/1.0 (contact@clienthunter.io)', 'Accept': 'application/json' },
      timeout: 10000,
    });
    return { ok: !!data?.data?.children, posts: data?.data?.children?.length || 0 };
  });
  res.json(result);
});

module.exports = router;
