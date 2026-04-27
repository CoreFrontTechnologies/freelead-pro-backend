/**
 * Leads Routes — all scans are now SYNCHRONOUS (wait for results before responding)
 */
const express = require('express');
const router  = express.Router();
const { query, run, get } = require('../db/database');
const logger  = require('../services/logger');

// GET /api/leads
router.get('/', async (req, res) => {
  try {
    const { status, source, min_score, limit=100, offset=0, search } = req.query;
    let sql = 'SELECT * FROM leads WHERE 1=1';
    const params = [];
    if (status)    { sql += ' AND status=?';              params.push(status); }
    if (source)    { sql += ' AND source=?';              params.push(source); }
    if (min_score) { sql += ' AND score>=?';              params.push(Number(min_score)); }
    if (search)    { sql += ' AND (name LIKE ? OR description LIKE ?)'; params.push(`%${search}%`,`%${search}%`); }
    sql += ' ORDER BY score DESC, created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const leads = await query(sql, params);
    const total = await get('SELECT COUNT(*) as count FROM leads');
    res.json({ leads, total: total.count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/stats/summary', async (req, res) => {
  try {
    const [total, byStatus, bySource] = await Promise.all([
      get('SELECT COUNT(*) as count FROM leads'),
      query('SELECT status, COUNT(*) as count FROM leads GROUP BY status'),
      query('SELECT source, COUNT(*) as count FROM leads GROUP BY source ORDER BY count DESC'),
    ]);
    res.json({ total: total.count, byStatus, bySource });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const lead = await get('SELECT * FROM leads WHERE id=?', [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'Not found' });
    res.json(lead);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, description, source='Manual', source_url, email, website, industry, budget_estimate, score=50, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await run(
      `INSERT INTO leads (name,description,source,source_url,email,website,industry,budget_estimate,score,notes) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [name,description,source,source_url,email,website,industry,budget_estimate,score,notes]
    );
    res.status(201).json(await get('SELECT * FROM leads WHERE id=?',[r.id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const { status, notes, email, score, budget_estimate } = req.body;
    const fields = []; const params = [];
    if (status)          { fields.push('status=?');          params.push(status); }
    if (notes!==undefined){ fields.push('notes=?');          params.push(notes); }
    if (email)           { fields.push('email=?');           params.push(email); }
    if (score)           { fields.push('score=?');           params.push(score); }
    if (budget_estimate) { fields.push('budget_estimate=?'); params.push(budget_estimate); }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    fields.push('updated_at=CURRENT_TIMESTAMP');
    params.push(req.params.id);
    await run(`UPDATE leads SET ${fields.join(',')} WHERE id=?`, params);
    res.json(await get('SELECT * FROM leads WHERE id=?',[req.params.id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await run('DELETE FROM leads WHERE id=?',[req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SCAN ENDPOINTS — all synchronous now ──────────────────────────

// Scan ALL sources
router.post('/scan/all', async (req, res) => {
  logger.info('Running full scan (all sources)...');
  const results = {};
  try {
    const { runJobBoardScan }     = require('../scrapers/jobBoards');
    const { runSocialScan }       = require('../scrapers/socialMedia');
    const { runMapsScan }         = require('../scrapers/googleMaps');
    const { runDomainScan }       = require('../scrapers/domainTracker');
    const { runGoogleSearchScan } = require('../scrapers/googleSearch');

    const [jobs, social, maps, domains, googleSearch] = await Promise.allSettled([
      runJobBoardScan(),
      runSocialScan(),
      runMapsScan(),
      runDomainScan(),
      runGoogleSearchScan(),
    ]);

    results.jobs         = jobs.value         || { error: jobs.reason?.message };
    results.social       = social.value       || { error: social.reason?.message };
    results.maps         = maps.value         || { error: maps.reason?.message };
    results.domains      = domains.value      || { error: domains.reason?.message };
    results.googleSearch = googleSearch.value || { error: googleSearch.reason?.message };

    const totalSaved = Object.values(results).reduce((s,r) => s + (r?.saved||0), 0);
    res.json({ success: true, totalSaved, results });
  } catch (err) {
    res.status(500).json({ error: err.message, results });
  }
});

router.post('/scan/jobs', async (req, res) => {
  try {
    const { runJobBoardScan } = require('../scrapers/jobBoards');
    const result = await runJobBoardScan();
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/scan/maps', async (req, res) => {
  try {
    const { runMapsScan } = require('../scrapers/googleMaps');
    const result = await runMapsScan(req.body.cities, req.body.types);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/scan/social', async (req, res) => {
  try {
    const { runSocialScan } = require('../scrapers/socialMedia');
    const result = await runSocialScan();
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/scan/domains', async (req, res) => {
  try {
    const { runDomainScan } = require('../scrapers/domainTracker');
    const result = await runDomainScan(req.body.domains);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/scan/google', async (req, res) => {
  try {
    const { runGoogleSearchScan } = require('../scrapers/googleSearch');
    const result = await runGoogleSearchScan();
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/scan/status', async (req, res) => {
  try {
    const logs = await query('SELECT * FROM scan_logs ORDER BY scanned_at DESC LIMIT 20');
    res.json(logs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
