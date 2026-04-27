require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json());

// ── Health check — must be first and always respond ───────────────
app.get('/api/health', (req, res) => {
  const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  res.status(200).json({
    status    : 'ok',
    version   : '1.0.0',
    timestamp : new Date().toISOString(),
    apis: {
      ai         : !!(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY),
      email      : !!(process.env.EMAIL_USER && process.env.EMAIL_PASS),
      googleMaps : !!process.env.GOOGLE_MAPS_API_KEY,
      twitter    : !!process.env.TWITTER_BEARER_TOKEN,
    }
  });
});

// ── Routes ────────────────────────────────────────────────────────
try {
  const leadsRouter    = require('./routes/leads');
  const outreachRouter = require('./routes/outreach');
  const testRouter     = require('./routes/test');
const logsRouter     = require('./routes/logs');
  app.use('/api/leads',    leadsRouter);
  app.use('/api/outreach', outreachRouter);
  app.use('/api/test',     testRouter);
app.use('/api/logs',     logsRouter);
} catch (err) {
  console.error('Failed to load routes:', err.message);
}

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start server FIRST, then init DB ─────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 LeadHive running on port ${PORT}`);
});

// Init DB in background after server is already listening
setTimeout(async () => {
  try {
    const fs = require('fs');
    if (!fs.existsSync('./logs')) fs.mkdirSync('./logs', { recursive: true });
    if (!fs.existsSync('./db'))   fs.mkdirSync('./db',   { recursive: true });

    const { initDb } = require('./db/database');
    await initDb();
    console.log('✅ Database ready');

    // Start cron jobs
    const cron = require('node-cron');
    const { runJobBoardScan } = require('./scrapers/jobBoards');
    const { runSocialScan }   = require('./scrapers/socialMedia');

    cron.schedule('0 */2 * * *', () => runJobBoardScan().catch(e => console.error('Cron jobs:', e.message)));
    cron.schedule('0 */4 * * *', () => runSocialScan().catch(e => console.error('Cron social:', e.message)));

    if (process.env.GOOGLE_MAPS_API_KEY) {
      const { runMapsScan } = require('./scrapers/googleMaps');
      cron.schedule('0 8 * * *', () => runMapsScan().catch(e => console.error('Cron maps:', e.message)));
    }

    if (process.env.EMAIL_USER) {
      const { processFollowUps } = require('./services/emailSender');
      cron.schedule('0 10 * * *', () => processFollowUps().catch(e => console.error('Cron followup:', e.message)));
    }

    console.log('✅ All systems ready');
  } catch (err) {
    console.error('Background init error (server still running):', err.message);
  }
}, 100);

module.exports = app;
