/**
 * Email Sender — Gmail via Nodemailer
 * Uses port 587 + STARTTLS (works on Railway)
 */
const nodemailer = require('nodemailer');
const { run, query } = require('../db/database');
const logger = require('./logger');

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error(
      'EMAIL_USER and EMAIL_PASS not set in Railway Variables.\n' +
      'EMAIL_PASS must be a Gmail App Password (16 chars), NOT your normal Gmail password.\n' +
      'Get one at: myaccount.google.com → Security → 2-Step Verification → App Passwords'
    );
  }

  // Use explicit host + port 587 (STARTTLS) — works on Railway
  _transporter = nodemailer.createTransport({
    host   : 'smtp.gmail.com',
    port   : 587,
    secure : false,   // STARTTLS — NOT SSL
    auth   : {
      user : process.env.EMAIL_USER,
      pass : process.env.EMAIL_PASS,
    },
    tls    : { rejectUnauthorized: false },
    connectionTimeout : 30000,
    greetingTimeout   : 30000,
    socketTimeout     : 30000,
  });

  return _transporter;
}

async function sendEmail({ to, subject, body, leadId }) {
  const transport = getTransporter();
  const fromName  = process.env.EMAIL_FROM_NAME || 'Client Hunter';

  const info = await transport.sendMail({
    from    : `"${fromName}" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text    : body,
    html    : body.replace(/\n/g, '<br>'),
  });

  logger.info(`Email sent to ${to} — messageId: ${info.messageId}`);

  if (leadId) {
    await run(
      `INSERT INTO outreach (lead_id,to_email,subject,body,status,sent_at) VALUES(?,?,?,?,'sent',CURRENT_TIMESTAMP)`,
      [leadId, to, subject, body]
    );
    await run(
      `UPDATE leads SET status='Contacted',updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [leadId]
    );
  }

  return { success: true, messageId: info.messageId };
}

async function processFollowUps() {
  const { generateFollowUp } = require('./aiEmail');
  const pending = await query(`
    SELECT o.*,l.name AS lead_name,l.description AS lead_desc,l.email AS lead_email
    FROM outreach o JOIN leads l ON o.lead_id=l.id
    WHERE o.status='sent' AND o.replied_at IS NULL
      AND o.follow_up_step < 3
      AND l.email IS NOT NULL AND l.email != ''
      AND datetime(o.sent_at,'+'||((o.follow_up_step+1)*3)||' days') <= CURRENT_TIMESTAMP
    LIMIT 10
  `);
  logger.info(`Processing ${pending.length} follow-ups`);
  for (const item of pending) {
    try {
      const nextStep = (item.follow_up_step||0) + 1;
      const { subject, body } = await generateFollowUp({ name: item.lead_name, desc: item.lead_desc }, item.body, nextStep);
      await sendEmail({ to: item.lead_email, subject, body, leadId: item.lead_id });
      await run(`UPDATE outreach SET follow_up_step=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, [nextStep, item.id]);
    } catch (err) { logger.error(`Follow-up ${item.id}: ${err.message}`); }
  }
  return pending.length;
}

async function verifyEmailConfig() {
  try {
    const t = getTransporter();
    await t.verify();
    return { ok: true, user: process.env.EMAIL_USER };
  } catch (err) {
    // Reset transporter so it's recreated on next try
    _transporter = null;
    return {
      ok    : false,
      error : err.message,
      hint  : 'Make sure EMAIL_PASS is a Gmail App Password (16 chars with spaces). Get it at myaccount.google.com → Security → App Passwords',
    };
  }
}

module.exports = { sendEmail, processFollowUps, verifyEmailConfig };
