/**
 * AI Email Service
 * Supports: Gemini (FREE) | OpenAI | Anthropic
 * Auto-detects which key you have in Railway Variables
 */
const axios  = require('axios');
const logger = require('./logger');

function getProvider() {
  if (process.env.GEMINI_API_KEY)    return 'gemini';
  if (process.env.OPENAI_API_KEY)    return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  throw new Error('No AI key found. Add GEMINI_API_KEY in Railway Variables (free at aistudio.google.com)');
}

// ── Gemini (FREE) ─────────────────────────────────────────────────
// Updated model names as of 2025
async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  const models = [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash-8b',
    'gemini-1.5-flash',
  ];
  let lastError;
  for (const model of models) {
    try {
      const { data } = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1000, temperature: 0.7 },
        },
        { timeout: 30000 }
      );
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty response');
      logger.info(`Gemini model ${model}: success`);
      return text;
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      logger.warn(`Gemini ${model} failed: ${msg}`);
      lastError = err;
    }
  }
  throw new Error(`All Gemini models failed. Last error: ${lastError?.message}`);
}

// ── OpenAI ────────────────────────────────────────────────────────
async function callOpenAI(prompt) {
  const { data } = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    { model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 1000 },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
  );
  return data.choices[0].message.content;
}

// ── Anthropic ─────────────────────────────────────────────────────
async function callAnthropic(prompt) {
  const { data } = await axios.post(
    'https://api.anthropic.com/v1/messages',
    { model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );
  return data.content[0].text;
}

async function callAI(prompt) {
  const provider = getProvider();
  logger.info(`AI provider: ${provider}`);
  if (provider === 'gemini')    return callGemini(prompt);
  if (provider === 'openai')    return callOpenAI(prompt);
  if (provider === 'anthropic') return callAnthropic(prompt);
}

function parseJSON(text) {
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in AI response: ${clean.substring(0, 100)}`);
  return JSON.parse(match[0]);
}

const SKILL_TONES = {
  web_design:        'You are a web designer who builds sites that generate real leads and sales.',
  graphic_design:    'You are a brand designer who makes businesses look professional and trustworthy.',
  video_editing:     'You are a video editor who helps businesses grow through compelling video content.',
  copywriting:       'You are a copywriter who helps businesses attract customers through words that convert.',
  social_media:      'You are a social media manager who builds brand presence and drives real engagement.',
  seo_marketing:     'You are an SEO expert who helps businesses rank higher and get more organic customers.',
  mobile_dev:        'You are a mobile developer who turns business ideas into powerful apps.',
  photography:       'You are a photographer who makes businesses look stunning and attract more clients.',
  virtual_assistant: 'You are a VA who saves business owners time so they can focus on growth.',
  other:             'You are a skilled freelancer who delivers real results for clients.',
};

const EMAIL_TONES = {
  professional: 'Professional and concise.',
  friendly:     'Warm and conversational.',
  bold:         'Confident and direct. Strong opener.',
};

function buildPrompt(lead, tone, sender) {
  const skill     = process.env.FREELANCE_SKILL || 'web_design';
  const skillTone = SKILL_TONES[skill] || SKILL_TONES.web_design;
  const name      = sender.name         || process.env.SENDER_NAME      || 'Alex';
  const skills    = sender.skills       || process.env.SENDER_SKILLS    || 'freelance services';
  const portfolio = sender.portfolioUrl || process.env.SENDER_PORTFOLIO || 'myportfolio.com';
  const emailTone = EMAIL_TONES[tone]   || EMAIL_TONES.professional;

  return `${skillTone}
Your name: ${name}. Your skills: ${skills}. Portfolio: ${portfolio}.

Write a cold outreach email for this lead:
- Company: ${lead.name}
- Need: ${lead.description || lead.desc || ''}
- Found via: ${lead.source || lead.src || ''}
- Industry: ${lead.industry || lead.ind || 'Unknown'}
- Budget: ${lead.budget_estimate || lead.budget || 'Unknown'}

Tone: ${emailTone}
Rules: 3-4 short paragraphs. Specific opener about THEIR business. One concrete result for similar clients. Soft CTA (15-min call). Sign off as ${name} only. Never use "I hope this email finds you well".

Respond ONLY with valid JSON (no markdown):
{"subject":"...","body":"..."}`;
}

async function generateColdEmail(lead, tone = 'professional', sender = {}) {
  const prompt = buildPrompt(lead, tone, sender);
  const text   = await callAI(prompt);
  const parsed = parseJSON(text);
  logger.info(`Email generated for: ${lead.name}`);
  return { subject: parsed.subject, body: parsed.body, tone };
}

async function generateSkillAwareEmail(lead, tone = 'professional', sender = {}) {
  return generateColdEmail(lead, tone, sender);
}

async function generateFollowUp(lead, originalBody, step = 1) {
  const guides = {
    1: 'Day 3 follow-up. 2 sentences max. Reference first email gently.',
    2: 'Day 7 follow-up. Add value — a tip or portfolio piece for their industry.',
    3: 'Day 14 final email. Short. Leave the door open warmly.',
  };
  const prompt = `Write a follow-up email.
Lead: ${lead.name} — ${lead.description || lead.desc}
Original: ${(originalBody||'').substring(0, 300)}
Context: ${guides[step] || guides[1]}
Respond ONLY with valid JSON: {"subject":"...","body":"..."}`;
  const text   = await callAI(prompt);
  const parsed = parseJSON(text);
  return { subject: parsed.subject, body: parsed.body };
}

async function analyseLeadWithAI(lead) {
  const prompt = `Score this freelance lead 0-100.
Lead: ${lead.name} | ${lead.description||lead.desc} | Source: ${lead.source||lead.src} | Budget: ${lead.budget_estimate||lead.budget}
Respond ONLY with valid JSON:
{"score":<0-100>,"priority":"high|medium|low","reasoning":"<one sentence>","suggested_approach":"<one sentence>"}`;
  const text   = await callAI(prompt);
  return parseJSON(text);
}

async function testAIConnection() {
  try {
    const provider = getProvider();
    logger.info(`Testing AI: ${provider}`);
    const text = await callAI('Reply with this exact JSON: {"status":"ok","message":"AI is working"}');
    const ok   = text.includes('ok');
    return { ok, provider, response: text.substring(0, 150) };
  } catch (err) {
    logger.error(`AI test failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { generateColdEmail, generateSkillAwareEmail, generateFollowUp, analyseLeadWithAI, testAIConnection };
