/**
 * Logs Route — real-time visibility into what's happening
 * GET /api/logs          → recent scan logs + system info
 * GET /api/logs/errors   → recent errors from log files
 */
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { query } = require('../db/database');

// GET /api/logs
router.get('/', async (req, res) => {
  try {
    const [scanLogs, recentLeads, stats] = await Promise.all([
      query('SELECT * FROM scan_logs ORDER BY scanned_at DESC LIMIT 30'),
      query('SELECT source, COUNT(*) as count FROM leads GROUP BY source ORDER BY count DESC'),
      query('SELECT status, COUNT(*) as count FROM leads GROUP BY status'),
    ]);

    const totalLeads = await query('SELECT COUNT(*) as total FROM leads');
    const totalOutreach = await query('SELECT COUNT(*) as total FROM outreach');

    // Read last 50 lines of combined log if it exists
    let recentLogs = [];
    const logPath = path.join(__dirname, '../logs/combined.log');
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8');
      recentLogs = content.split('\n').filter(Boolean).slice(-50).reverse();
    }

    res.json({
      system: {
        uptime    : Math.round(process.uptime()) + 's',
        memory    : Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        nodeVersion: process.version,
        env       : {
          skill      : process.env.FREELANCE_SKILL || 'web_design (default)',
          ai         : process.env.GEMINI_API_KEY ? 'Gemini ✅' : process.env.OPENAI_API_KEY ? 'OpenAI ✅' : process.env.ANTHROPIC_API_KEY ? 'Anthropic ✅' : 'NOT SET ❌',
          email      : process.env.EMAIL_USER ? `${process.env.EMAIL_USER} ✅` : 'NOT SET ❌',
          googleMaps : process.env.GOOGLE_MAPS_API_KEY ? 'SET ✅' : 'NOT SET ❌',
          twitter    : process.env.TWITTER_BEARER_TOKEN ? 'SET ✅' : 'Not set (using Nitter)',
          googleSearch: process.env.GOOGLE_SEARCH_API_KEY ? 'SET ✅' : 'NOT SET ❌',
        },
      },
      database: {
        totalLeads    : totalLeads[0]?.total || 0,
        totalOutreach : totalOutreach[0]?.total || 0,
        leadsBySource : recentLeads,
        leadsByStatus : stats,
      },
      recentScans: scanLogs,
      recentLogs  : recentLogs.slice(0, 50),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/logs/errors
router.get('/errors', (req, res) => {
  try {
    const logPath = path.join(__dirname, '../logs/error.log');
    if (!fs.existsSync(logPath)) {
      return res.json({ errors: [], note: 'No error log file yet — good sign!' });
    }
    const content = fs.readFileSync(logPath, 'utf8');
    const errors  = content.split('\n').filter(Boolean).slice(-30).reverse();
    res.json({ errors, count: errors.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
