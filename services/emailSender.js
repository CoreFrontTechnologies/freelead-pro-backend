/**
 * Email Sender — Resend (primary) + Gmail fallback
 * Resend: free 3000 emails/month, no SMTP issues on Railway
 * Get key at resend.com → API Keys → Create (choose "Sending access" scope)
 */
const axios  = require('axios');
const { run, query } = require('../db/database');
const logger = require('./logger');

async function sendViaResend({ to, subject, body, fromName }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not set');

  // Resend requires a verified domain for from address
  // Until domain is verified, use their onboarding address
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const from = `${fromName || 'Client Hunter'} <${fromEmail}>`;

  const { data } = await axios.post(
    'https://api.resend.com/emails',
    { from, to: [to], subject, text: body, html: body.replace(/\n/g, '<br>') },
    { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 15000 }
  );

  logger.info(`Resend: email sent to ${to} — id: ${data.id}`);
  return { success: true, messageId: data.id, provider: 'resend' };
}

async function sendViaGmail({ to, subject, body, fromName }) {
  const nodemailer = require('nodemailer');
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) throw new Error('EMAIL_USER and EMAIL_PASS not set');

  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 30000, greetingTimeout: 15000, socketTimeout: 30000,
  });

  const info = await transport.sendMail({
    from: `"${fromName||'Client Hunter'}" <${process.env.EMAIL_USER}>`,
    to, subject, text: body, html: body.replace(/\n/g, '<br>'),
  });
  logger.info(`Gmail: sent to ${to} — ${info.messageId}`);
  return { success: true, messageId: info.messageId, provider: 'gmail' };
}

async function sendEmail({ to, subject, body, leadId }) {
  const fromName = process.env.EMAIL_FROM_NAME || 'Client Hunter';
  let result;

  if (process.env.RESEND_API_KEY) {
    result = await sendViaResend({ to, subject, body, fromName });
  } else if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    result = await sendViaGmail({ to, subject, body, fromName });
  } else {
    throw new Error('No email provider configured. Add RESEND_API_KEY (free at resend.com) to Railway Variables.');
  }

  if (leadId) {
    await run(`INSERT INTO outreach (lead_id,to_email,subject,body,status,sent_at) VALUES(?,?,?,?,'sent',CURRENT_TIMESTAMP)`, [leadId, to, subject, body]);
    await run(`UPDATE leads SET status='Contacted',updated_at=CURRENT_TIMESTAMP WHERE id=?`, [leadId]);
  }
  return result;
}

async function processFollowUps() {
  const { generateFollowUp } = require('./aiEmail');
  const pending = await query(`
    SELECT o.*,l.name AS lead_name,l.description AS lead_desc,l.email AS lead_email
    FROM outreach o JOIN leads l ON o.lead_id=l.id
    WHERE o.status='sent' AND o.replied_at IS NULL AND o.follow_up_step < 3
      AND l.email IS NOT NULL AND l.email != ''
      AND datetime(o.sent_at,'+'||((o.follow_up_step+1)*3)||' days') <= CURRENT_TIMESTAMP
    LIMIT 10`);
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
  // Test Resend by sending a test call to /emails/validate (doesn't actually send)
  if (process.env.RESEND_API_KEY) {
    try {
      // Just check the key is valid by hitting the emails endpoint with a minimal request
      // We check by trying to get API key info
      const { data } = await axios.get('https://api.resend.com/api-keys', {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        timeout: 8000,
      });
      return { ok: true, provider: 'Resend', note: '3000 free emails/month. Make sure RESEND_FROM_EMAIL is set or use onboarding@resend.dev for testing.' };
    } catch (err) {
      // 403 means key exists but restricted scope — that's fine for sending!
      if (err.response?.status === 403) {
        return { ok: true, provider: 'Resend', note: 'Key is valid for sending emails ✅ (restricted to sending only — this is correct)' };
      }
      return { ok: false, provider: 'Resend', error: err.response?.data?.message || err.message,
        hint: 'Get a fresh API key from resend.com → API Keys → Create API Key' };
    }
  }

  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    try {
      const nodemailer = require('nodemailer');
      const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }, connectionTimeout: 15000 });
      await t.verify();
      return { ok: true, provider: 'Gmail', user: process.env.EMAIL_USER };
    } catch (err) {
      return { ok: false, provider: 'Gmail', error: err.message, hint: 'EMAIL_PASS must be a Gmail App Password. Get at: myaccount.google.com → Security → App Passwords' };
    }
  }

  return { ok: false, error: 'No email provider configured', hint: 'Add RESEND_API_KEY to Railway Variables. Get free key at resend.com' };
}

module.exports = { sendEmail, processFollowUps, verifyEmailConfig };
