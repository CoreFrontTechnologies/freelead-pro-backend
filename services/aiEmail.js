/**
 * AI Email Service
 * Works with OpenAI (GPT-4) OR Gemini OR Anthropic
 * Set whichever key you have in Railway Variables
 */

const axios = require('axios');
const logger = require('./logger');

// Auto-detect which AI provider to use based on available keys
function getProvider() {
  if (process.env.OPENAI_API_KEY)    return 'openai';
  if (process.env.GEMINI_API_KEY)    return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  throw new Error('No AI API key found. Add OPENAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY in Railway Variables.');
}

const TONES = {
  professional : 'Professional and concise. Confident and respectful.',
  friendly     : 'Warm and conversational. Like a helpful colleague.',
  bold         : 'Confident and direct. Strong opener. Get to the value fast.',
};

function buildPrompt(lead, tone, sender) {
  const senderName   = sender.name         || process.env.SENDER_NAME      || 'Alex';
  const senderSkills = sender.skills       || process.env.SENDER_SKILLS    || 'web design and UI/UX';
  const portfolio    = sender.portfolioUrl || process.env.SENDER_PORTFOLIO || 'myportfolio.com';
  const toneGuide    = TONES[tone] || TONES.professional;

  return `You are a freelance web designer writing a cold outreach email to a potential client.

SENDER: ${senderName} | Skills: ${senderSkills} | Portfolio: ${portfolio}

LEAD:
- Company: ${lead.name}
- What they need: ${lead.description || lead.desc || ''}
- Found via: ${lead.source || lead.src || ''}
- Industry: ${lead.industry || lead.ind || 'Unknown'}
- Budget: ${lead.budget_estimate || lead.budget || 'Unknown'}
- Website: ${lead.website || lead.web || 'None'}

TONE: ${toneGuide}

Rules:
1. Subject: specific and compelling, under 9 words
2. Open with ONE specific observation about THEIR business
3. Mention one concrete result you got for a similar client
4. End with a soft CTA — suggest a 15-minute call
5. 3-4 short paragraphs only
6. Never use "I hope this email finds you well"
7. Sign off with sender name only

Respond ONLY with valid JSON, no markdown:
{"subject":"...","body":"..."}`;
}

// ── OpenAI ────────────────────────────────────────────────────────
async function callOpenAI(prompt) {
  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model    : 'gpt-4o-mini', // cheap and fast — change to gpt-4o for better quality
      messages : [{ role: 'user', content: prompt }],
      max_tokens: 900,
    },
    {
      headers : {
        'Authorization' : `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type'  : 'application/json',
      },
      timeout: 30000,
    }
  );
  return res.data.choices[0].message.content;
}

// ── Gemini ────────────────────────────────────────────────────────
async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 900 },
    },
    { timeout: 30000 }
  );
  return res.data.candidates[0].content.parts[0].text;
}

// ── Anthropic ─────────────────────────────────────────────────────
async function callAnthropic(prompt) {
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model      : 'claude-sonnet-4-20250514',
      max_tokens : 900,
      messages   : [{ role: 'user', content: prompt }],
    },
    {
      headers : {
        'x-api-key'         : process.env.ANTHROPIC_API_KEY,
        'anthropic-version' : '2023-06-01',
        'Content-Type'      : 'application/json',
      },
      timeout: 30000,
    }
  );
  return res.data.content[0].text;
}

// ── Main call (auto picks provider) ──────────────────────────────
async function callAI(prompt) {
  const provider = getProvider();
  logger.info(`Using AI provider: ${provider}`);
  if (provider === 'openai')    return callOpenAI(prompt);
  if (provider === 'gemini')    return callGemini(prompt);
  if (provider === 'anthropic') return callAnthropic(prompt);
}

function parseJSON(text) {
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

// ── Generate cold email ───────────────────────────────────────────
async function generateColdEmail(lead, tone = 'professional', sender = {}) {
  const prompt = buildPrompt(lead, tone, sender);
  const text   = await callAI(prompt);
  const parsed = parseJSON(text);
  logger.info(`Cold email generated for: ${lead.name}`);
  return { subject: parsed.subject, body: parsed.body, tone };
}

// ── Generate follow-up ────────────────────────────────────────────
async function generateFollowUp(lead, originalBody, step = 1) {
  const stepGuides = {
    1: 'Day 3 follow-up. Very short — 2 sentences. Reference first email gently.',
    2: 'Day 7 follow-up. Add value — a quick tip or portfolio piece for their industry.',
    3: 'Day 14 final email. Short. Last one. Leave the door open warmly.',
  };

  const prompt = `You are a freelance web designer sending a follow-up email.
LEAD: ${lead.name} — ${lead.description || lead.desc}
ORIGINAL EMAIL: ${originalBody}
CONTEXT: ${stepGuides[step] || stepGuides[1]}
Respond ONLY with valid JSON: {"subject":"...","body":"..."}`;

  const text   = await callAI(prompt);
  const parsed = parseJSON(text);
  return { subject: parsed.subject, body: parsed.body };
}

// ── AI lead scoring ───────────────────────────────────────────────
async function analyseLeadWithAI(lead) {
  const prompt = `Score this freelance lead 0-100. Higher = more likely to hire and pay well.
LEAD: ${lead.name} | ${lead.description || lead.desc} | Source: ${lead.source || lead.src} | Budget: ${lead.budget_estimate || lead.budget}
Respond ONLY with valid JSON:
{"score":<0-100>,"priority":"high"|"medium"|"low","reasoning":"<one sentence>","suggested_approach":"<one sentence>"}`;

  const text   = await callAI(prompt);
  return parseJSON(text);
}

// ── Test connection ───────────────────────────────────────────────
async function testAIConnection() {
  try {
    const provider = getProvider();
    const text = await callAI('Say OK in one word.');
    return { ok: true, provider, response: text.trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { generateColdEmail, generateFollowUp, analyseLeadWithAI, testAIConnection };
