/**
 * FreeLead Pro — Main Server
 * Express API + scheduled scans + background jobs
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const { initDb } = require('./db/database');
const logger = require('./services/logger');

const leadsRouter = require('./routes/leads');
const outreachRouter = require('./routes/outreach');
const testRouter     = require('./routes/test');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ───────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,           // e.g. https://freelead-pro.netlify.app
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, mobile apps)
    if (!origin) return cb(null, true);
    if (process.env.NODE_ENV !== 'production') return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting — prevent API abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests — please try again later' }
});
app.use('/api/', limiter);

// Request logging
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// ── Routes ───────────────────────────────────────────────────────
app.use('/api/leads', leadsRouter);
app.use('/api/test',  testRouter);
app.use('/api/outreach', outreachRouter);

// Health check
app.get('/api/health', async (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    features: {
      ai: !!process.env.ANTHROPIC_API_KEY,
      googleMaps: !!process.env.GOOGLE_MAPS_API_KEY,
      twitter: !!process.env.TWITTER_BEARER_TOKEN,
      email: !!(process.env.EMAIL_USER && process.env.EMAIL_PASS)
    }
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, _req, res, _next) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Scheduled Cron Jobs ──────────────────────────────────────────
function startCronJobs() {
  const { runJobBoardScan } = require('./scrapers/jobBoards');
  const { runMapsScan } = require('./scrapers/googleMaps');
  const { runSocialScan } = require('./scrapers/socialMedia');
  const { runDomainScan } = require('./scrapers/domainTracker');
  const { processFollowUps } = require('./services/emailSender');

  // Job boards — every 2 hours
  cron.schedule('0 */2 * * *', async () => {
    logger.info('[CRON] Running job board scan...');
    await runJobBoardScan().catch(err => logger.error(`Cron job board: ${err.message}`));
  });

  // Google Maps — once a day at 8am
  cron.schedule('0 8 * * *', async () => {
    logger.info('[CRON] Running Google Maps scan...');
    await runMapsScan().catch(err => logger.error(`Cron maps: ${err.message}`));
  });

  // Social media — every 4 hours
  cron.schedule('0 */4 * * *', async () => {
    logger.info('[CRON] Running social media scan...');
    await runSocialScan().catch(err => logger.error(`Cron social: ${err.message}`));
  });

  // Domain tracker — once a day at 9am
  cron.schedule('0 9 * * *', async () => {
    logger.info('[CRON] Running domain expiry scan...');
    await runDomainScan().catch(err => logger.error(`Cron domains: ${err.message}`));
  });

  // Follow-up emails — every morning at 10am
  cron.schedule('0 10 * * *', async () => {
    logger.info('[CRON] Processing follow-up emails...');
    await processFollowUps().catch(err => logger.error(`Cron follow-ups: ${err.message}`));
  });

  logger.info('✅ Cron jobs scheduled');
}

// ── Bootstrap ────────────────────────────────────────────────────
async function bootstrap() {
  // Create logs directory
  const fs = require('fs');
  if (!fs.existsSync('./logs')) fs.mkdirSync('./logs');

  // Initialise database
  await initDb();
  logger.info('✅ Database initialised');

  // Start scheduled jobs
  startCronJobs();

  // Start server
  app.listen(PORT, () => {
    logger.info(`🚀 FreeLead Pro API running on http://localhost:${PORT}`);
    logger.info(`📋 API docs: http://localhost:${PORT}/api/health`);
  });
}

bootstrap().catch(err => {
  logger.error(`Failed to start: ${err.message}`);
  process.exit(1);
});

module.exports = app;
