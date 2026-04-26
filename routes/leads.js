/**
 * Leads Routes
 * GET/POST/PATCH/DELETE for leads + trigger manual scans
 */

const express = require('express');
const router = express.Router();
const { query, run, get } = require('../db/database');
const { runJobBoardScan } = require('../scrapers/jobBoards');
const { runMapsScan } = require('../scrapers/googleMaps');
const { runSocialScan } = require('../scrapers/socialMedia');
const { runDomainScan } = require('../scrapers/domainTracker');
const { analyseLeadWithAI } = require('../services/aiEmail');
const logger = require('../services/logger');

// GET /api/leads — list all leads with filters
router.get('/', async (req, res) => {
  try {
    const {
      status, source, min_score, max_score,
      industry, limit = 50, offset = 0, search
    } = req.query;

    let sql = 'SELECT * FROM leads WHERE 1=1';
    const params = [];

    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (source) { sql += ' AND source = ?'; params.push(source); }
    if (min_score) { sql += ' AND score >= ?'; params.push(Number(min_score)); }
    if (max_score) { sql += ' AND score <= ?'; params.push(Number(max_score)); }
    if (industry) { sql += ' AND industry LIKE ?'; params.push(`%${industry}%`); }
    if (search) {
      sql += ' AND (name LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY score DESC, created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const leads = await query(sql, params);
    const total = await get('SELECT COUNT(*) as count FROM leads WHERE 1=1');

    res.json({ leads, total: total.count });
  } catch (err) {
    logger.error(`GET /leads failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/:id
router.get('/:id', async (req, res) => {
  try {
    const lead = await get('SELECT * FROM leads WHERE id = ?', [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads — create a manual lead
router.post('/', async (req, res) => {
  try {
    const { name, description, source = 'Manual', source_url, email,
            website, industry, budget_estimate, score = 50, notes } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });

    const result = await run(
      `INSERT INTO leads (name, description, source, source_url, email, website, industry, budget_estimate, score, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, description, source, source_url, email, website, industry, budget_estimate, score, notes]
    );

    const lead = await get('SELECT * FROM leads WHERE id = ?', [result.id]);
    res.status(201).json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leads/:id — update lead (status, notes, email, etc.)
router.patch('/:id', async (req, res) => {
  try {
    const { status, notes, email, score, budget_estimate, industry } = req.body;
    const fields = [];
    const params = [];

    if (status) { fields.push('status = ?'); params.push(status); }
    if (notes !== undefined) { fields.push('notes = ?'); params.push(notes); }
    if (email) { fields.push('email = ?'); params.push(email); }
    if (score) { fields.push('score = ?'); params.push(score); }
    if (budget_estimate) { fields.push('budget_estimate = ?'); params.push(budget_estimate); }
    if (industry) { fields.push('industry = ?'); params.push(industry); }

    if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id);

    await run(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`, params);
    const lead = await get('SELECT * FROM leads WHERE id = ?', [req.params.id]);
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/leads/:id
router.delete('/:id', async (req, res) => {
  try {
    await run('DELETE FROM leads WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/:id/analyse — AI lead analysis
router.post('/:id/analyse', async (req, res) => {
  try {
    const lead = await get('SELECT * FROM leads WHERE id = ?', [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const analysis = await analyseLeadWithAI(lead);

    // Update score in DB
    await run(
      'UPDATE leads SET score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [analysis.score, req.params.id]
    );

    res.json({ lead, analysis });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/scan/all — trigger all scanners
router.post('/scan/all', async (req, res) => {
  res.json({ message: 'Scan started in background. Check /api/leads/scan/status for results.' });

  // Run in background
  Promise.allSettled([
    runJobBoardScan(),
    runMapsScan(),
    runSocialScan(),
    runDomainScan()
  ]).then(results => {
    logger.info('Full scan complete:', results.map(r => r.value || r.reason));
  });
});

// POST /api/leads/scan/jobs
router.post('/scan/jobs', async (req, res) => {
  try {
    const result = await runJobBoardScan();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/scan/maps
router.post('/scan/maps', async (req, res) => {
  try {
    const { cities, types } = req.body;
    const result = await runMapsScan(cities, types);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/scan/social
router.post('/scan/social', async (req, res) => {
  try {
    const result = await runSocialScan();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/scan/domains
router.post('/scan/domains', async (req, res) => {
  try {
    const { domains } = req.body;
    const result = await runDomainScan(domains);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/scan/status — recent scan logs
router.get('/scan/status', async (req, res) => {
  try {
    const logs = await query(
      'SELECT * FROM scan_logs ORDER BY scanned_at DESC LIMIT 20'
    );
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/stats/summary
router.get('/stats/summary', async (req, res) => {
  try {
    const [total, byStatus, bySource, avgScore] = await Promise.all([
      get('SELECT COUNT(*) as count FROM leads'),
      query('SELECT status, COUNT(*) as count FROM leads GROUP BY status'),
      query('SELECT source, COUNT(*) as count FROM leads GROUP BY source ORDER BY count DESC'),
      get('SELECT AVG(score) as avg FROM leads')
    ]);

    res.json({
      total: total.count,
      byStatus,
      bySource,
      averageScore: Math.round(avgScore.avg || 0)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
