/**
 * Email Sender — Resend (primary) with Gmail fallback
 * Resend: free 3000 emails/month — get key at resend.com
 * IMPORTANT: Set RESEND_FROM_EMAIL=onboarding@resend.dev in Railway Variables
 *            until you verify your own domain on resend.com
 */
const axios  = require('axios');
const { run, query } = require('../db/database');
const logger = require('./logger');

async function sendViaResend({ to, subject, body, fromName }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not set');

  // Use verified from address — set RESEND_FROM_EMAIL in Railway Variables
  // Until domain verified, use onboarding@resend.dev
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const from = `${fromName || 'Client Hunter'} <${fromEmail}>`;

  logger.info(`Resend: sending from ${from} to ${to}`);

  const { data } = await axios.post(
    'https://api.resend.com/emails',
    { from, to: [to], subject, text: body, html: body.replace(/\n/g, '<br>') },
    { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 15000 }
  );

  logger.info(`Resend: sent to ${to} — id: ${data.id}`);
  return { success: true, messageId: data.id, provider: 'resend' };
}

async function sendViaGmail({ to, subject, body, fromName }) {
  const nodemailer = require('nodemailer');
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('EMAIL_USER and EMAIL_PASS not set');
  }
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 30000, greetingTimeout: 15000,
  });
  const info = await transport.sendMail({
    from: `"${fromName || 'Client Hunter'}" <${process.env.EMAIL_USER}>`,
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
    throw new Error('No email provider. Add RESEND_API_KEY to Railway Variables (free at resend.com)');
  }

  if (leadId) {
    try {
      await run(
        `INSERT INTO outreach (lead_id,to_email,subject,body,status,sent_at) VALUES(?,?,?,?,'sent',CURRENT_TIMESTAMP)`,
        [leadId, to, subject, body]
      );
      await run(`UPDATE leads SET status='Contacted',updated_at=CURRENT_TIMESTAMP WHERE id=?`, [leadId]);
    } catch(e) { logger.warn(`DB update after send: ${e.message}`); }
  }
  return result;
}

async function processFollowUps() {
  const { generateFollowUp } = require('./aiEmail');
  try {
    const pending = await query(`
      SELECT o.*,l.name AS lead_name,l.description AS lead_desc,l.email AS lead_email
      FROM outreach o JOIN leads l ON o.lead_id=l.id
      WHERE o.status='sent' AND o.replied_at IS NULL AND o.follow_up_step < 3
        AND l.email IS NOT NULL AND l.email != ''
      LIMIT 10
    `);
    for (const item of pending) {
      try {
        const step = (item.follow_up_step || 0) + 1;
        const { subject, body } = await generateFollowUp({ name: item.lead_name, desc: item.lead_desc }, item.body, step);
        await sendEmail({ to: item.lead_email, subject, body, leadId: item.lead_id });
        await run(`UPDATE outreach SET follow_up_step=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, [step, item.id]);
      } catch(e) { logger.error(`Follow-up ${item.id}: ${e.message}`); }
    }
    return pending.length;
  } catch(e) { logger.error(`processFollowUps: ${e.message}`); return 0; }
}

async function verifyEmailConfig() {
  if (process.env.RESEND_API_KEY) {
    try {
      // Test by checking API key validity
      await axios.get('https://api.resend.com/api-keys', {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        timeout: 8000,
      });
      return { ok: true, provider: 'Resend', from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev' };
    } catch (err) {
      // 403 = key valid but restricted to sending only — that's fine!
      if (err.response?.status === 403) {
        return { ok: true, provider: 'Resend', note: 'Key valid for sending ✅', from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev' };
      }
      return { ok: false, provider: 'Resend', error: err.response?.data?.message || err.message,
        hint: 'Check RESEND_API_KEY in Railway Variables. Also set RESEND_FROM_EMAIL=onboarding@resend.dev' };
    }
  }
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    try {
      const nodemailer = require('nodemailer');
      const t = nodemailer.createTransport({ host:'smtp.gmail.com',port:587,secure:false,auth:{user:process.env.EMAIL_USER,pass:process.env.EMAIL_PASS},connectionTimeout:15000 });
      await t.verify();
      return { ok: true, provider: 'Gmail', user: process.env.EMAIL_USER };
    } catch(e) {
      return { ok: false, provider: 'Gmail', error: e.message, hint: 'EMAIL_PASS must be a Gmail App Password from myaccount.google.com' };
    }
  }
  return { ok: false, error: 'No email provider configured', hint: 'Add RESEND_API_KEY to Railway Variables. Free at resend.com. Also add RESEND_FROM_EMAIL=onboarding@resend.dev' };
}

module.exports = { sendEmail, processFollowUps, verifyEmailConfig };
