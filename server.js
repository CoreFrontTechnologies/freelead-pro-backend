require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const app     = express();
const PORT    = process.env.PORT || 3001;

// ── CORS ──────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check — must respond immediately ───────────────────────
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status    : 'ok',
    version   : '2.0.0',
    timestamp : new Date().toISOString(),
    database  : process.env.DATABASE_URL ? 'postgresql' : 'sqlite',
    apis: {
      ai          : !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY),
      email       : !!(process.env.RESEND_API_KEY || (process.env.EMAIL_USER && process.env.EMAIL_PASS)),
      googleMaps  : !!process.env.GOOGLE_MAPS_API_KEY,
      googleSearch: !!(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX),
    }
  });
});

// ── Routes ────────────────────────────────────────────────────────
app.use('/api/leads',    require('./routes/leads'));
app.use('/api/outreach', require('./routes/outreach'));
app.use('/api/test',     require('./routes/test'));
app.use('/api/logs',     require('./routes/logs'));

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('Unhandled:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start server first, then init DB in background ────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Client Hunter API running on port ${PORT}`);
});

setTimeout(async () => {
  const fs = require('fs');
  if (!fs.existsSync('./logs')) fs.mkdirSync('./logs', { recursive: true });
  if (!fs.existsSync('./db'))   fs.mkdirSync('./db',   { recursive: true });

  try {
    const { initDb } = require('./db/database');
    await initDb();

    // Start cron jobs after DB is ready
    const cron = require('node-cron');
    const { runJobBoardScan } = require('./scrapers/jobBoards');
    const { runSocialScan }   = require('./scrapers/socialMedia');

    cron.schedule('0 */3 * * *', () => runJobBoardScan().catch(e => console.error('Cron jobs:', e.message)));
    cron.schedule('0 */5 * * *', () => runSocialScan().catch(e => console.error('Cron social:', e.message)));

    if (process.env.GOOGLE_MAPS_API_KEY) {
      const { runMapsScan } = require('./scrapers/googleMaps');
      cron.schedule('0 8 * * *', () => runMapsScan().catch(e => console.error('Cron maps:', e.message)));
    }
    if (process.env.RESEND_API_KEY || process.env.EMAIL_USER) {
      const { processFollowUps } = require('./services/emailSender');
      cron.schedule('0 10 * * *', () => processFollowUps().catch(e => console.error('Cron followups:', e.message)));
    }

    console.log('✅ Database ready, cron jobs scheduled');
  } catch (err) {
    console.error('❌ Init error (server still running):', err.message);
  }
}, 100);

module.exports = app;
