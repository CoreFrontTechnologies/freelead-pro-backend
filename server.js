require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3001; // Railway sets PORT automatically

// ── Middleware ────────────────────────────────────────────────────
app.use(cors({ origin: '*' })); // open for now — lock down after frontend is live
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use('/api/', limiter);

// ── Health check (must respond FAST — Railway checks this on startup) ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    apis: {
      ai:        !!process.env.ANTHROPIC_API_KEY,
      email:     !!(process.env.EMAIL_USER && process.env.EMAIL_PASS),
      googleMaps:!!process.env.GOOGLE_MAPS_API_KEY,
      twitter:   !!process.env.TWITTER_BEARER_TOKEN,
    }
  });
});

// ── Routes ────────────────────────────────────────────────────────
const leadsRouter    = require('./routes/leads');
const outreachRouter = require('./routes/outreach');
const testRouter     = require('./routes/test');

app.use('/api/leads',    leadsRouter);
app.use('/api/outreach', outreachRouter);
app.use('/api/test',     testRouter);

// 404
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// Error handler
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Database + Start ──────────────────────────────────────────────
async function start() {
  const fs = require('fs');
  if (!fs.existsSync('./logs')) fs.mkdirSync('./logs');
  if (!fs.existsSync('./db'))   fs.mkdirSync('./db');

  // Init database
  const { initDb } = require('./db/database');
  await initDb();
  console.log('✅ Database ready');

  // Start cron jobs only if we have the needed keys
  startCronJobs();

  // Start server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 LeadHive API running on port ${PORT}`);
    console.log(`📋 Health: http://localhost:${PORT}/api/health`);
  });
}

function startCronJobs() {
  const { runJobBoardScan } = require('./scrapers/jobBoards');
  const { runSocialScan }   = require('./scrapers/socialMedia');

  // Job boards every 2 hours
  cron.schedule('0 */2 * * *', () => {
    console.log('[CRON] Job board scan...');
    runJobBoardScan().catch(e => console.error('Cron jobs error:', e.message));
  });

  // Social media every 4 hours
  cron.schedule('0 */4 * * *', () => {
    console.log('[CRON] Social scan...');
    runSocialScan().catch(e => console.error('Cron social error:', e.message));
  });

  // Google Maps once a day — only if key is set
  if (process.env.GOOGLE_MAPS_API_KEY) {
    const { runMapsScan } = require('./scrapers/googleMaps');
    cron.schedule('0 8 * * *', () => {
      console.log('[CRON] Maps scan...');
      runMapsScan().catch(e => console.error('Cron maps error:', e.message));
    });
  }

  // Follow-ups every morning
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    const { processFollowUps } = require('./services/emailSender');
    cron.schedule('0 10 * * *', () => {
      console.log('[CRON] Follow-ups...');
      processFollowUps().catch(e => console.error('Cron followups error:', e.message));
    });
  }

  console.log('✅ Cron jobs scheduled');
}

start().catch(err => {
  console.error('❌ Failed to start server:', err.message);
  process.exit(1);
});

module.exports = app;
