const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './db/freelead.sqlite';

let db;

function getDb() {
  if (!db) {
    db = new sqlite3.Database(path.resolve(DB_PATH), (err) => {
      if (err) {
        console.error('Failed to connect to SQLite:', err.message);
        process.exit(1);
      }
      console.log('✅ Connected to SQLite database');
    });
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');
  }
  return db;
}

function initDb() {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.serialize(() => {

      // Leads table
      db.run(`
        CREATE TABLE IF NOT EXISTS leads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          source TEXT NOT NULL,
          source_url TEXT,
          email TEXT,
          website TEXT,
          industry TEXT,
          budget_estimate TEXT,
          score INTEGER DEFAULT 0,
          status TEXT DEFAULT 'New',
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Outreach / emails table
      db.run(`
        CREATE TABLE IF NOT EXISTS outreach (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lead_id INTEGER NOT NULL,
          to_email TEXT NOT NULL,
          subject TEXT NOT NULL,
          body TEXT NOT NULL,
          status TEXT DEFAULT 'draft',
          sent_at DATETIME,
          opened_at DATETIME,
          replied_at DATETIME,
          follow_up_step INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
        )
      `);

      // Email templates table
      db.run(`
        CREATE TABLE IF NOT EXISTS templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          subject TEXT NOT NULL,
          body TEXT NOT NULL,
          category TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Scan logs table
      db.run(`
        CREATE TABLE IF NOT EXISTS scan_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          leads_found INTEGER DEFAULT 0,
          status TEXT DEFAULT 'success',
          error TEXT,
          scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) reject(err);
        else {
          seedTemplates(db);
          resolve();
        }
      });
    });
  });
}

function seedTemplates(db) {
  db.get('SELECT COUNT(*) as count FROM templates', [], (err, row) => {
    if (!err && row.count === 0) {
      const templates = [
        {
          name: 'Cold Outreach — Agency',
          subject: 'Quick question about {{company}}\'s website',
          body: `Hi {{name}},

I came across {{company}} and was impressed by your work — though I noticed your website could better reflect the quality of what you do.

I'm a web designer specialising in building clean, fast, conversion-focused sites for agencies. I've recently helped similar businesses increase inbound leads by 35–50% through better design and UX.

Would you be open to a free 20-minute audit of your current site? No strings attached.

Best,
{{sender_name}}`,
          category: 'Agency'
        },
        {
          name: 'Local Business — No Website',
          subject: 'Your business deserves a great website',
          body: `Hi {{name}},

I found {{company}} on Google Maps and noticed you don't have a website yet. In today's market, 81% of customers research online before visiting — a professional site could significantly grow your foot traffic.

I build affordable, mobile-friendly websites specifically for local businesses like yours, usually within 2 weeks.

I'd love to show you what I could put together. Can I send over a quick mockup?

Best,
{{sender_name}}`,
          category: 'Local Business'
        },
        {
          name: 'Domain Expiry Hook',
          subject: 'Your website domain is expiring soon',
          body: `Hi {{name}},

I noticed that {{company}}'s domain is expiring very soon. If it lapses, your website goes offline — which can hurt your Google ranking and customer trust.

I can help you not only renew and secure your domain, but also take this as an opportunity to refresh and improve your site at the same time.

Happy to jump on a quick call this week?

Best,
{{sender_name}}`,
          category: 'Domain'
        },
        {
          name: 'Social DM Template',
          subject: 'Saw your post about needing a web designer',
          body: `Hi {{name}},

I saw your post about looking for a web designer — I'd love to help! I specialise in building fast, beautiful sites that generate real leads.

I've attached a couple of recent projects. Happy to share more or jump on a quick call if you'd like to chat.

{{sender_name}}`,
          category: 'Social'
        }
      ];

      const stmt = db.prepare(
        'INSERT INTO templates (name, subject, body, category) VALUES (?, ?, ?, ?)'
      );
      templates.forEach(t => stmt.run(t.name, t.subject, t.body, t.category));
      stmt.finalize();
    }
  });
}

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

module.exports = { initDb, query, run, get };
