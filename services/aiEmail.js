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

// ── Skill-aware prompt builder ────────────────────────────────────
const SKILL_EMAIL_TONES = {
  web_design:    'Position yourself as a web designer who builds sites that generate real leads and sales for businesses.',
  graphic_design:'Position yourself as a brand designer who makes businesses look professional, trustworthy, and memorable.',
  video_editing: 'Position yourself as a video editor who helps businesses grow their audience and engagement through compelling video content.',
  copywriting:   'Position yourself as a copywriter who helps businesses attract more customers through words that convert.',
  social_media:  'Position yourself as a social media manager who builds brand presence and drives real followers and engagement.',
  seo_marketing: 'Position yourself as an SEO expert who helps businesses rank higher on Google and get more organic customers.',
  mobile_dev:    'Position yourself as a mobile developer who turns business ideas into powerful apps their customers love.',
  photography:   'Position yourself as a photographer who makes businesses look stunning and attract more clients.',
  virtual_assistant: 'Position yourself as a VA who saves business owners time so they can focus on growth.',
};

async function generateSkillAwareEmail(lead, tone = 'professional', sender = {}) {
  const skill       = process.env.FREELANCE_SKILL || 'web_design';
  const skillTone   = SKILL_EMAIL_TONES[skill] || SKILL_EMAIL_TONES.web_design;
  const senderName  = sender.name         || process.env.SENDER_NAME      || 'Alex';
  const senderSkills= sender.skills       || process.env.SENDER_SKILLS    || 'freelance services';
  const portfolio   = sender.portfolioUrl || process.env.SENDER_PORTFOLIO || 'myportfolio.com';

  const tones = { professional:'Professional and concise.', friendly:'Warm and conversational.', bold:'Confident and direct.' };

  const prompt = `You are a freelancer named ${senderName}. Skills: ${senderSkills}. Portfolio: ${portfolio}.
${skillTone}

LEAD:
- Company: ${lead.name}
- What they need: ${lead.description || lead.desc}
- Found via: ${lead.source || lead.src}
- Industry: ${lead.industry || lead.ind || 'Unknown'}
- Budget: ${lead.budget_estimate || lead.budget || 'Unknown'}

Tone: ${tones[tone] || tones.professional}

Write a cold outreach email:
1. Specific opener about THEIR business — not generic
2. One concrete result you achieved for a similar client
3. Soft CTA — suggest a 15-minute call
4. 3-4 short paragraphs max
5. Sign off as ${senderName} only

Respond ONLY with valid JSON, no backticks:
{"subject":"...","body":"..."}`;

  const text = await callAI(prompt);
  const parsed = parseJSON(text);
  return { subject: parsed.subject, body: parsed.body, tone, skill };
}

module.exports.generateSkillAwareEmail = generateSkillAwareEmail;
