/**
 * Outreach Routes
 * AI email generation + email sending + template management
 */

const express = require('express');
const router = express.Router();
const { query, run, get } = require('../db/database');
const { generateColdEmail, generateFollowUp } = require('../services/aiEmail');
const { sendEmail, processFollowUps, verifyEmailConfig } = require('../services/emailSender');
const logger = require('../services/logger');

// POST /api/outreach/generate — AI email generation
router.post('/generate', async (req, res) => {
  try {
    const { lead_id, tone = 'professional', sender } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id is required' });

    const lead = await get('SELECT * FROM leads WHERE id = ?', [lead_id]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Use skill-aware generation if available
    let email;
    try {
      const { generateSkillAwareEmail } = require('../services/aiEmail');
      email = await generateSkillAwareEmail(lead, tone, sender || {});
    } catch(e) {
      email = await generateColdEmail(lead, tone, sender || {});
    }
    res.json({ success: true, ...email, lead });
  } catch (err) {
    logger.error(`Email generation failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/outreach/generate-followup
router.post('/generate-followup', async (req, res) => {
  try {
    const { outreach_id, follow_up_step = 1 } = req.body;

    if (!outreach_id) return res.status(400).json({ error: 'outreach_id is required' });

    const outreach = await get(
      `SELECT o.*, l.name as lead_name, l.description as lead_desc
       FROM outreach o JOIN leads l ON o.lead_id = l.id
       WHERE o.id = ?`,
      [outreach_id]
    );
    if (!outreach) return res.status(404).json({ error: 'Outreach not found' });

    const email = await generateFollowUp(
      { name: outreach.lead_name, description: outreach.lead_desc },
      outreach.body,
      follow_up_step
    );

    res.json({ success: true, ...email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/outreach/send — send an email
router.post('/send', async (req, res) => {
  try {
    const { lead_id, to, subject, body } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'to, subject, and body are required' });
    }

    const result = await sendEmail({ to, subject, body, leadId: lead_id });
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error(`Send email failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/outreach/send-generated — generate + send in one step
router.post('/send-generated', async (req, res) => {
  try {
    const { lead_id, to, tone = 'professional', sender } = req.body;

    if (!lead_id || !to) {
      return res.status(400).json({ error: 'lead_id and to are required' });
    }

    const lead = await get('SELECT * FROM leads WHERE id = ?', [lead_id]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Use skill-aware generation if available
    let email;
    try {
      const { generateSkillAwareEmail } = require('../services/aiEmail');
      email = await generateSkillAwareEmail(lead, tone, sender || {});
    } catch(e) {
      email = await generateColdEmail(lead, tone, sender || {});
    }
    const result = await sendEmail({ to, subject: email.subject, body: email.body, leadId: lead_id });

    res.json({ success: true, email, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/outreach — list sent emails
router.get('/', async (req, res) => {
  try {
    const { lead_id, status, limit = 50 } = req.query;
    let sql = `SELECT o.*, l.name as lead_name FROM outreach o
               JOIN leads l ON o.lead_id = l.id WHERE 1=1`;
    const params = [];

    if (lead_id) { sql += ' AND o.lead_id = ?'; params.push(lead_id); }
    if (status) { sql += ' AND o.status = ?'; params.push(status); }

    sql += ' ORDER BY o.created_at DESC LIMIT ?';
    params.push(Number(limit));

    const emails = await query(sql, params);
    res.json(emails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/outreach/process-followups — manually trigger follow-up processing
router.post('/process-followups', async (req, res) => {
  try {
    const count = await processFollowUps();
    res.json({ success: true, processed: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/outreach/templates — list templates
router.get('/templates', async (req, res) => {
  try {
    const templates = await query('SELECT * FROM templates ORDER BY created_at DESC');
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/outreach/templates — create template
router.post('/templates', async (req, res) => {
  try {
    const { name, subject, body, category } = req.body;
    if (!name || !subject || !body) {
      return res.status(400).json({ error: 'name, subject, and body are required' });
    }

    const result = await run(
      'INSERT INTO templates (name, subject, body, category) VALUES (?, ?, ?, ?)',
      [name, subject, body, category]
    );

    const template = await get('SELECT * FROM templates WHERE id = ?', [result.id]);
    res.status(201).json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/outreach/templates/:id
router.delete('/templates/:id', async (req, res) => {
  try {
    await run('DELETE FROM templates WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/outreach/stats
router.get('/stats', async (req, res) => {
  try {
    const [sent, opened, replied] = await Promise.all([
      get("SELECT COUNT(*) as count FROM outreach WHERE status = 'sent'"),
      get("SELECT COUNT(*) as count FROM outreach WHERE opened_at IS NOT NULL"),
      get("SELECT COUNT(*) as count FROM outreach WHERE replied_at IS NOT NULL")
    ]);

    const sentCount = sent.count || 0;
    res.json({
      sent: sentCount,
      opened: opened.count,
      replied: replied.count,
      openRate: sentCount ? ((opened.count / sentCount) * 100).toFixed(1) + '%' : '0%',
      replyRate: sentCount ? ((replied.count / sentCount) * 100).toFixed(1) + '%' : '0%'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/outreach/verify-email — check email config
router.get('/verify-email', async (req, res) => {
  const result = await verifyEmailConfig();
  res.json(result);
});

module.exports = router;
