const express = require('express');
const router  = express.Router();

router.get('/all', async (req, res) => {
  const results = {};

  try {
    const { testAIConnection } = require('../services/aiEmail');
    results.ai = await testAIConnection();
  } catch (e) { results.ai = { ok: false, error: e.message }; }

  try {
    const { verifyEmailConfig } = require('../services/emailSender');
    results.gmail = await verifyEmailConfig();
  } catch (e) { results.gmail = { ok: false, error: e.message }; }

  try {
    const { testMapsConnection } = require('../scrapers/googleMaps');
    results.googleMaps = await testMapsConnection();
  } catch (e) { results.googleMaps = { ok: false, error: e.message }; }

  try {
    const { testTwitterConnection } = require('../scrapers/socialMedia');
    results.twitter = await testTwitterConnection();
  } catch (e) { results.twitter = { ok: false, error: e.message }; }

  try {
    const axios = require('axios');
    const r = await axios.get('https://www.reddit.com/r/Entrepreneur/new.json?limit=1', {
      headers: { 'User-Agent': 'FreeleadPro/1.0' }, timeout: 5000,
    });
    results.reddit = { ok: !!r.data?.data, note: 'No API key required' };
  } catch (e) { results.reddit = { ok: false, error: e.message }; }

  res.json({ allOk: Object.values(results).every(r => r.ok), results });
});

router.get('/ai',      async (req, res) => { try { const { testAIConnection }    = require('../services/aiEmail');    res.json(await testAIConnection());    } catch(e){ res.status(500).json({ok:false,error:e.message}); }});
router.get('/email',   async (req, res) => { try { const { verifyEmailConfig }   = require('../services/emailSender'); res.json(await verifyEmailConfig());   } catch(e){ res.status(500).json({ok:false,error:e.message}); }});
router.get('/maps',    async (req, res) => { try { const { testMapsConnection }  = require('../scrapers/googleMaps');  res.json(await testMapsConnection());  } catch(e){ res.status(500).json({ok:false,error:e.message}); }});
router.get('/twitter', async (req, res) => { try { const { testTwitterConnection }= require('../scrapers/socialMedia');res.json(await testTwitterConnection());} catch(e){ res.status(500).json({ok:false,error:e.message}); }});

module.exports = router;
