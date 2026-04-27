/**
 * AI Email Service
 * Supports: Gemini (FREE) | OpenAI | Anthropic
 * Auto-detects which key you have set in Railway Variables
 */
const axios  = require('axios');
const logger = require('./logger');

function getProvider() {
  if (process.env.GEMINI_API_KEY)    return 'gemini';
  if (process.env.OPENAI_API_KEY)    return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  throw new Error(
    'No AI key found. Add one of these in Railway → Variables:\n' +
    '  GEMINI_API_KEY (free at aistudio.google.com)\n' +
    '  OPENAI_API_KEY (platform.openai.com)\n' +
    '  ANTHROPIC_API_KEY (console.anthropic.com)'
  );
}

// ── Gemini (FREE — recommended) ────────────────────────────────────
async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  // Try gemini-1.5-flash first (fast + free), fallback to gemini-pro
  const models = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];
  let lastError;
  for (const model of models) {
    try {
      const { data } = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1000 } },
        { timeout: 30000 }
      );
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty response from Gemini');
      logger.info(`Gemini (${model}): success`);
      return text;
    } catch (err) {
      lastError = err;
      logger.warn(`Gemini ${model} failed: ${err.response?.data?.error?.message || err.message}`);
    }
  }
  throw lastError;
}

// ── OpenAI ─────────────────────────────────────────────────────────
async function callOpenAI(prompt) {
  const { data } = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    { model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 1000 },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
  );
  return data.choices[0].message.content;
}

// ── Anthropic ──────────────────────────────────────────────────────
async function callAnthropic(prompt) {
  // Use correct model string
  const model = 'claude-sonnet-4-6';
  const { data } = await axios.post(
    'https://api.anthropic.com/v1/messages',
    { model, max_tokens: 1000, messages: [{ role: 'user', content: prompt }] },
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
  // Strip markdown code blocks if present
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  // Find JSON object in the text
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in AI response');
  return JSON.parse(match[0]);
}

// ── Skill-aware email tones ────────────────────────────────────────
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
  professional: 'Professional and concise. Respectful and confident.',
  friendly:     'Warm and conversational. Like a helpful colleague.',
  bold:         'Confident and direct. Strong opener. Get to the value fast.',
};

function buildPrompt(lead, tone, sender) {
  const skill      = process.env.FREELANCE_SKILL || 'web_design';
  const skillTone  = SKILL_TONES[skill] || SKILL_TONES.web_design;
  const name       = sender.name         || process.env.SENDER_NAME      || 'Alex';
  const skills     = sender.skills       || process.env.SENDER_SKILLS    || 'freelance services';
  const portfolio  = sender.portfolioUrl || process.env.SENDER_PORTFOLIO || 'myportfolio.com';
  const emailTone  = EMAIL_TONES[tone]   || EMAIL_TONES.professional;

  return `${skillTone}
Your name: ${name}
Your skills: ${skills}
Your portfolio: ${portfolio}

Write a cold outreach email for this lead:
- Company: ${lead.name}
- Need: ${lead.description || lead.desc || ''}
- Found via: ${lead.source || lead.src || ''}
- Industry: ${lead.industry || lead.ind || 'Unknown'}
- Budget: ${lead.budget_estimate || lead.budget || 'Unknown'}

Tone: ${emailTone}

Rules:
1. Subject line under 9 words — specific to their business
2. Open with ONE specific observation about THEIR situation
3. Mention one concrete result you got for a similar client (use realistic numbers)
4. Soft CTA — suggest a 15-minute call
5. 3-4 short paragraphs only
6. Never use "I hope this email finds you well"
7. Sign off as ${name} only

Respond ONLY with valid JSON (no markdown, no backticks):
{"subject":"...","body":"..."}`;
}

// ── Main exports ───────────────────────────────────────────────────
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
    1: 'Day 3 follow-up. 2 sentences max. Reference first email gently. No pressure.',
    2: 'Day 7 follow-up. Add value — a quick tip or portfolio piece for their industry.',
    3: 'Day 14 final email. Short. Last one. Leave the door open warmly.',
  };
  const prompt = `Write a follow-up email.
Lead: ${lead.name} — ${lead.description || lead.desc}
Original email: ${originalBody}
Context: ${guides[step] || guides[1]}
Respond ONLY with valid JSON: {"subject":"...","body":"..."}`;

  const text   = await callAI(prompt);
  const parsed = parseJSON(text);
  return { subject: parsed.subject, body: parsed.body };
}

async function analyseLeadWithAI(lead) {
  const prompt = `Score this freelance lead 0-100. Higher = more likely to hire and pay well.
Lead: ${lead.name} | ${lead.description||lead.desc} | Source: ${lead.source||lead.src} | Budget: ${lead.budget_estimate||lead.budget}
Respond ONLY with valid JSON:
{"score":<0-100>,"priority":"high"|"medium"|"low","reasoning":"<one sentence>","suggested_approach":"<one sentence>"}`;
  const text   = await callAI(prompt);
  return parseJSON(text);
}

async function testAIConnection() {
  try {
    const provider = getProvider();
    logger.info(`Testing AI connection: ${provider}`);
    const text = await callAI('Reply with exactly: {"status":"ok"}');
    // Try to parse it, if not just check it has "ok"
    const ok = text.includes('ok');
    return { ok, provider, response: text.substring(0, 100) };
  } catch (err) {
    logger.error(`AI test failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  generateColdEmail,
  generateSkillAwareEmail,
  generateFollowUp,
  analyseLeadWithAI,
  testAIConnection,
};
