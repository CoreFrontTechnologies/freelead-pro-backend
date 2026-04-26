/**
 * Test Routes — verify every API connection is working
 * GET /api/test/all        → test all APIs at once
 * GET /api/test/ai         → test Anthropic
 * GET /api/test/email      → test Gmail SMTP
 * GET /api/test/maps       → test Google Maps
 * GET /api/test/twitter    → test Twitter/X
 * GET /api/test/reddit     → test Reddit (always works, no key needed)
 */

const express = require('express');
const router  = express.Router();
const logger  = require('../services/logger');

// GET /api/test/all
router.get('/all', async (req, res) => {
  logger.info('Running full API connection test...');
  const results = {};

  // Anthropic AI
  try {
    const { testAnthropicConnection } = require('../services/aiEmail');
    results.anthropic = await testAnthropicConnection();
  } catch (err) {
    results.anthropic = { ok: false, error: err.message };
  }

  // Gmail
  try {
    const { verifyEmailConfig } = require('../services/emailSender');
    results.gmail = await verifyEmailConfig();
  } catch (err) {
    results.gmail = { ok: false, error: err.message };
  }

  // Google Maps
  try {
    const { testMapsConnection } = require('../scrapers/googleMaps');
    results.googleMaps = await testMapsConnection();
  } catch (err) {
    results.googleMaps = { ok: false, error: err.message };
  }

  // Twitter
  try {
    const { testTwitterConnection } = require('../scrapers/socialMedia');
    results.twitter = await testTwitterConnection();
  } catch (err) {
    results.twitter = { ok: false, error: err.message };
  }

  // Reddit (no key needed — just check it responds)
  try {
    const axios = require('axios');
    const r = await axios.get('https://www.reddit.com/r/Entrepreneur/new.json?limit=1', {
      headers : { 'User-Agent': 'FreeleadPro/1.0' },
      timeout : 5000,
    });
    results.reddit = { ok: !!r.data?.data, note: 'No API key required' };
  } catch (err) {
    results.reddit = { ok: false, error: err.message };
  }

  const allOk = Object.values(results).every(r => r.ok);
  res.json({ allOk, results });
});

// GET /api/test/ai
router.get('/ai', async (req, res) => {
  try {
    const { testAnthropicConnection } = require('../services/aiEmail');
    const result = await testAnthropicConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/test/email
router.get('/email', async (req, res) => {
  try {
    const { verifyEmailConfig } = require('../services/emailSender');
    const result = await verifyEmailConfig();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/test/maps
router.get('/maps', async (req, res) => {
  try {
    const { testMapsConnection } = require('../scrapers/googleMaps');
    const result = await testMapsConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/test/twitter
router.get('/twitter', async (req, res) => {
  try {
    const { testTwitterConnection } = require('../scrapers/socialMedia');
    const result = await testTwitterConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/test/reddit
router.get('/reddit', async (req, res) => {
  try {
    const axios = require('axios');
    const r = await axios.get('https://www.reddit.com/r/Entrepreneur/new.json?limit=1', {
      headers : { 'User-Agent': 'FreeleadPro/1.0' },
      timeout : 5000,
    });
    res.json({ ok: true, note: 'No API key required', posts: r.data?.data?.children?.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
