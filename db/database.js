/**
 * Database — PostgreSQL (primary) with SQLite fallback
 * Railway PostgreSQL: add via Railway dashboard → New → Database → PostgreSQL
 * DATABASE_URL is automatically set by Railway when you add PostgreSQL
 */
const logger = require('../services/logger');

let pgClient = null;
let sqliteDb = null;
let usingPostgres = false;

// ── PostgreSQL setup ──────────────────────────────────────────────
async function setupPostgres() {
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  pgClient = client;
  usingPostgres = true;
  logger.info('✅ Connected to PostgreSQL');

  await client.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      source TEXT NOT NULL,
      source_url TEXT UNIQUE,
      email TEXT,
      website TEXT,
      industry TEXT,
      budget_estimate TEXT,
      score INTEGER DEFAULT 0,
      status TEXT DEFAULT 'New',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS outreach (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      sent_at TIMESTAMP,
      opened_at TIMESTAMP,
      replied_at TIMESTAMP,
      follow_up_step INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS scan_logs (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      leads_found INTEGER DEFAULT 0,
      status TEXT DEFAULT 'success',
      error TEXT,
      scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  logger.info('✅ PostgreSQL tables ready');
}

// ── SQLite fallback ───────────────────────────────────────────────
async function setupSQLite() {
  const sqlite3 = require('sqlite3').verbose();
  const path = require('path');
  const fs = require('fs');
  const dbDir = path.resolve('./db');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(path.join(dbDir, 'freelead.sqlite'), (err) => {
      if (err) return reject(err);
      logger.info('✅ Connected to SQLite (fallback)');
      sqliteDb = db;
      db.run('PRAGMA journal_mode = WAL');
      db.run('PRAGMA foreign_keys = ON');
      db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, source TEXT NOT NULL, source_url TEXT UNIQUE, email TEXT, website TEXT, industry TEXT, budget_estimate TEXT, score INTEGER DEFAULT 0, status TEXT DEFAULT 'New', notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS outreach (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER, to_email TEXT, subject TEXT, body TEXT, status TEXT DEFAULT 'draft', sent_at DATETIME, opened_at DATETIME, replied_at DATETIME, follow_up_step INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, subject TEXT, body TEXT, category TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS scan_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, leads_found INTEGER DEFAULT 0, status TEXT DEFAULT 'success', error TEXT, scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP)`, resolve);
      });
    });
  });
}

// ── Init ──────────────────────────────────────────────────────────
async function initDb() {
  if (process.env.DATABASE_URL) {
    try {
      await setupPostgres();
      return;
    } catch (err) {
      logger.warn(`PostgreSQL failed (${err.message}), falling back to SQLite`);
    }
  }
  await setupSQLite();
  logger.warn('Using SQLite — data will reset on Railway redeploy. Add PostgreSQL in Railway dashboard.');
}

// ── Query helpers — work for both PG and SQLite ───────────────────
async function query(sql, params = []) {
  if (usingPostgres) {
    // Convert SQLite ? placeholders to PG $1 $2 etc
    let i = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++i}`);
    const result = await pgClient.query(pgSql, params);
    return result.rows;
  }
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

async function run(sql, params = []) {
  if (usingPostgres) {
    let i = 0;
    const pgSql = sql
      .replace(/\?/g, () => `$${++i}`)
      .replace(/INSERT OR IGNORE/gi, 'INSERT')
      .replace(/AUTOINCREMENT/gi, '')
      + (sql.toUpperCase().includes('INSERT') ? ' ON CONFLICT (source_url) DO NOTHING RETURNING id' : '');
    try {
      const result = await pgClient.query(pgSql, params);
      const id = result.rows?.[0]?.id || null;
      const changes = result.rowCount || 0;
      return { id, changes };
    } catch (err) {
      // Unique violation — treat as "already exists"
      if (err.code === '23505') return { id: null, changes: 0 };
      throw err;
    }
  }
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function(err) {
      err ? reject(err) : resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

async function get(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

module.exports = { initDb, query, run, get };
