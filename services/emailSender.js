/**
 * Email Sender — Gmail SMTP via Nodemailer
 * Sends real emails + tracks them in the database
 */

const nodemailer = require('nodemailer');
const { run, query, get } = require('../db/database');
const logger = require('./logger');

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error(
      'EMAIL_USER and EMAIL_PASS are not set.\n' +
      'Add them in Railway → Variables.\n' +
      'EMAIL_PASS must be a Gmail App Password (not your normal password).\n' +
      'Get one at: myaccount.google.com → Security → App Passwords'
    );
  }

  _transporter = nodemailer.createTransport({
    service : 'gmail',
    auth    : {
      user : process.env.EMAIL_USER,
      pass : process.env.EMAIL_PASS,
    },
  });

  return _transporter;
}

// ── Send a single email ───────────────────────────────────────────
async function sendEmail({ to, subject, body, leadId }) {
  const transport  = getTransporter();
  const fromName   = process.env.EMAIL_FROM_NAME || 'FreeLead Pro';
  const fromEmail  = process.env.EMAIL_USER;

  const info = await transport.sendMail({
    from    : `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text    : body,
    html    : body.replace(/\n/g, '<br>'),
  });

  logger.info(`Email sent → ${to} | messageId: ${info.messageId}`);

  if (leadId) {
    await run(
      `INSERT INTO outreach (lead_id, to_email, subject, body, status, sent_at)
       VALUES (?, ?, ?, ?, 'sent', CURRENT_TIMESTAMP)`,
      [leadId, to, subject, body]
    );
    await run(
      `UPDATE leads SET status = 'Contacted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [leadId]
    );
  }

  return { success: true, messageId: info.messageId };
}

// ── Process automatic follow-ups ──────────────────────────────────
async function processFollowUps() {
  const { generateFollowUp } = require('./aiEmail');

  // Find leads contacted 3+ days ago with no reply, not yet at step 3
  const pending = await query(`
    SELECT o.*, l.name AS lead_name, l.description AS lead_desc, l.email AS lead_email
    FROM outreach o
    JOIN leads l ON o.lead_id = l.id
    WHERE o.status = 'sent'
      AND o.replied_at IS NULL
      AND o.follow_up_step < 3
      AND l.email IS NOT NULL AND l.email != ''
      AND datetime(o.sent_at, '+' || ((o.follow_up_step + 1) * 3) || ' days') <= CURRENT_TIMESTAMP
    LIMIT 20
  `);

  logger.info(`Processing ${pending.length} follow-up emails...`);

  for (const item of pending) {
    try {
      const nextStep = (item.follow_up_step || 0) + 1;
      const { subject, body } = await generateFollowUp(
        { name: item.lead_name, desc: item.lead_desc },
        item.body,
        nextStep
      );

      await sendEmail({ to: item.lead_email, subject, body, leadId: item.lead_id });

      await run(
        `UPDATE outreach SET follow_up_step = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [nextStep, item.id]
      );

      logger.info(`Follow-up step ${nextStep} sent to ${item.lead_email}`);
    } catch (err) {
      logger.error(`Follow-up failed for outreach ${item.id}: ${err.message}`);
    }
  }

  return pending.length;
}

// ── Test Gmail connection ─────────────────────────────────────────
async function verifyEmailConfig() {
  try {
    const t = getTransporter();
    await t.verify();
    return { ok: true, user: process.env.EMAIL_USER };
  } catch (err) {
    return {
      ok    : false,
      error : err.message,
      hint  : 'Make sure EMAIL_PASS is a Gmail App Password, not your normal Gmail password.',
    };
  }
}

module.exports = { sendEmail, processFollowUps, verifyEmailConfig };
