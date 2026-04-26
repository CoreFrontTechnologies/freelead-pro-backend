/**
 * AI Email Service — Anthropic Claude
 * Generates personalised cold emails, follow-ups, and lead scores
 */

const Anthropic = require('@anthropic-ai/sdk');
const logger = require('./logger');

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it in Railway → Variables.');
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const TONES = {
  professional : 'Professional and concise. Respectful and confident.',
  friendly     : 'Warm and conversational. Like a helpful colleague.',
  bold         : 'Confident and direct. Strong opener. Get to the value fast.',
};

// ── Generate cold email ───────────────────────────────────────────
async function generateColdEmail(lead, tone = 'professional', sender = {}) {
  const client = getClient();

  const senderName     = sender.name         || process.env.SENDER_NAME     || 'Alex';
  const senderSkills   = sender.skills       || process.env.SENDER_SKILLS   || 'web design and UI/UX';
  const portfolioUrl   = sender.portfolioUrl || process.env.SENDER_PORTFOLIO || 'alexdesigns.com';
  const toneGuide      = TONES[tone] || TONES.professional;

  const prompt = `You are a freelance web designer writing a cold outreach email to a potential client.

SENDER:
- Name: ${senderName}
- Skills: ${senderSkills}
- Portfolio: ${portfolioUrl}

LEAD:
- Company: ${lead.name}
- What they need: ${lead.description || lead.desc}
- How we found them: ${lead.source || lead.src}
- Industry: ${lead.industry || lead.ind || 'Unknown'}
- Estimated budget: ${lead.budget_estimate || lead.budget || 'Unknown'}
- Their website: ${lead.website || lead.web || 'None'}

TONE: ${toneGuide}

Write a cold outreach email following these rules:
1. Subject: compelling, specific, under 9 words
2. Open with ONE specific observation about THEIR business — not generic
3. Mention one concrete result you achieved for a similar client (use realistic numbers)
4. Short, clear CTA — suggest a 15-minute call, nothing pushy
5. 3-4 short paragraphs maximum
6. Never use "I hope this email finds you well" or similar clichés
7. Sign off with sender name only

Respond ONLY with valid JSON, no markdown, no backticks:
{"subject":"...","body":"..."}`;

  const message = await client.messages.create({
    model      : 'claude-sonnet-4-20250514',
    max_tokens : 900,
    messages   : [{ role: 'user', content: prompt }],
  });

  const text   = message.content[0]?.text || '{}';
  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

  logger.info(`AI email generated for lead: ${lead.name} | tone: ${tone}`);
  return { subject: parsed.subject, body: parsed.body, tone, model: 'claude-sonnet-4-20250514' };
}

// ── Generate follow-up email ──────────────────────────────────────
async function generateFollowUp(lead, originalEmailBody, step = 1) {
  const client = getClient();

  const stepGuides = {
    1: 'Day 3 follow-up. Very short — 2 sentences max. Reference the first email gently. No pressure.',
    2: 'Day 7 follow-up. Add a small piece of value — a relevant insight, quick tip, or portfolio piece for their industry.',
    3: 'Day 14 final email (breakup email). Short. Let them know this is the last one. Leave the door open warmly.',
  };

  const prompt = `You are a freelance web designer sending a follow-up email.

LEAD: ${lead.name} — ${lead.description || lead.desc}

ORIGINAL EMAIL:
${originalEmailBody}

FOLLOW-UP CONTEXT: ${stepGuides[step] || stepGuides[1]}

Write the follow-up. Respond ONLY with valid JSON:
{"subject":"...","body":"..."}`;

  const message = await client.messages.create({
    model      : 'claude-sonnet-4-20250514',
    max_tokens : 400,
    messages   : [{ role: 'user', content: prompt }],
  });

  const text   = message.content[0]?.text || '{}';
  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  return { subject: parsed.subject, body: parsed.body };
}

// ── AI lead scoring ───────────────────────────────────────────────
async function analyseLeadWithAI(lead) {
  const client = getClient();

  const prompt = `You are a lead qualification expert for a freelance web designer.

Analyse this lead and score it 0–100.

LEAD:
- Name: ${lead.name}
- Description: ${lead.description || lead.desc}
- Source: ${lead.source || lead.src}
- Budget: ${lead.budget_estimate || lead.budget}
- Industry: ${lead.industry || lead.ind}

Score higher for: urgent language, clear budget, e-commerce/agency work, redesign projects.
Score lower for: vague requests, no budget, unclear industry.

Respond ONLY with valid JSON:
{
  "score": <0-100>,
  "priority": "high" | "medium" | "low",
  "reasoning": "<one sentence>",
  "suggested_approach": "<one sentence on how to reach out>",
  "estimated_budget": "<realistic estimate e.g. $1,500–$3,000>"
}`;

  const message = await client.messages.create({
    model      : 'claude-sonnet-4-20250514',
    max_tokens : 300,
    messages   : [{ role: 'user', content: prompt }],
  });

  const text   = message.content[0]?.text || '{}';
  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  return parsed;
}

// ── Health check ──────────────────────────────────────────────────
async function testAnthropicConnection() {
  try {
    const client = getClient();
    const msg = await client.messages.create({
      model      : 'claude-sonnet-4-20250514',
      max_tokens : 10,
      messages   : [{ role: 'user', content: 'Say OK' }],
    });
    return { ok: true, response: msg.content[0]?.text };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { generateColdEmail, generateFollowUp, analyseLeadWithAI, testAnthropicConnection };
