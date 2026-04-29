/**
 * AI Email Service
 * Supports: Gemini | OpenAI | Anthropic
 * 
 * IMPORTANT — Gemini key must come from AI STUDIO, not Google Cloud:
 *   Go to: aistudio.google.com → Get API Key → Create API key
 *   That key has free quota. Cloud Console keys have quota=0.
 */
const axios  = require('axios');
const logger = require('./logger');

function getProvider() {
  if (process.env.GEMINI_API_KEY)    return 'gemini';
  if (process.env.OPENAI_API_KEY)    return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  throw new Error(
    'No AI key found. Add GEMINI_API_KEY in Railway Variables.\n' +
    'IMPORTANT: Get your Gemini key from aistudio.google.com NOT from Google Cloud Console.\n' +
    'AI Studio keys have free quota. Cloud Console keys have quota=0.'
  );
}

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;

  // Try v1 endpoint first (more stable), then v1beta
  // Model list updated for 2025/2026
  const attempts = [
    { base: 'https://generativelanguage.googleapis.com/v1',     model: 'gemini-2.0-flash' },
    { base: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' },
    { base: 'https://generativelanguage.googleapis.com/v1',     model: 'gemini-1.5-flash' },
    { base: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash' },
    { base: 'https://generativelanguage.googleapis.com/v1',     model: 'gemini-pro' },
    { base: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-pro' },
  ];

  let lastError;
  for (const { base, model } of attempts) {
    try {
      const url = `${base}/models/${model}:generateContent?key=${key}`;
      const { data } = await axios.post(
        url,
        { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1000, temperature: 0.7 } },
        { timeout: 30000 }
      );
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty response from Gemini');
      logger.info(`Gemini OK: ${model} on ${base.includes('v1beta') ? 'v1beta' : 'v1'}`);
      return text;
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      // If quota exceeded, no point trying same model on other endpoint
      if (msg.includes('Quota exceeded') || msg.includes('quota')) {
        logger.warn(`Gemini ${model}: quota exceeded — KEY ISSUE: Get key from aistudio.google.com not Cloud Console`);
        lastError = new Error(`Gemini quota exceeded. Your GEMINI_API_KEY was created in Google Cloud Console (quota=0). Please create a NEW key at aistudio.google.com and update GEMINI_API_KEY in Railway Variables.`);
        break;
      }
      logger.warn(`Gemini ${model}: ${msg}`);
      lastError = err;
    }
  }
  throw lastError || new Error('All Gemini attempts failed');
}

async function callOpenAI(prompt) {
  const { data } = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    { model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 1000 },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
  );
  return data.choices[0].message.content;
}

async function callAnthropic(prompt) {
  const { data } = await axios.post(
    'https://api.anthropic.com/v1/messages',
    { model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] },
    {
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
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
  const clean = (text || '').replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in response: ${clean.substring(0, 100)}`);
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

function buildPrompt(lead, tone, sender) {
  const skill     = process.env.FREELANCE_SKILL || 'web_design';
  const skillTone = SKILL_TONES[skill] || SKILL_TONES.web_design;
  const name      = sender.name         || process.env.SENDER_NAME      || 'Alex';
  const skills    = sender.skills       || process.env.SENDER_SKILLS    || 'freelance services';
  const portfolio = sender.portfolioUrl || process.env.SENDER_PORTFOLIO || 'myportfolio.com';
  const toneMap   = { professional: 'Professional and concise.', friendly: 'Warm and conversational.', bold: 'Confident and direct.' };

  return `${skillTone}
Name: ${name}. Skills: ${skills}. Portfolio: ${portfolio}.

Write a cold outreach email for this lead:
- Company: ${lead.name}
- Need: ${lead.description || lead.desc || ''}
- Found via: ${lead.source || lead.src || ''}
- Industry: ${lead.industry || lead.ind || 'Unknown'}
- Budget: ${lead.budget_estimate || lead.budget || 'Unknown'}

Tone: ${toneMap[tone] || toneMap.professional}
Rules: 3-4 short paragraphs. Specific opener about THEIR business. One concrete result for a similar client. Soft CTA (15-min call). Sign off as ${name} only.

Respond ONLY with valid JSON (no markdown, no backticks):
{"subject":"...","body":"..."}`;
}

async function generateColdEmail(lead, tone = 'professional', sender = {}) {
  const text   = await callAI(buildPrompt(lead, tone, sender));
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
    2: 'Day 7. Add value — a tip or portfolio piece for their industry.',
    3: 'Day 14 final. Short. Leave door open warmly.',
  };
  const text   = await callAI(`Write follow-up email.\nLead: ${lead.name}\nOriginal: ${(originalBody||'').substring(0,200)}\nContext: ${guides[step]||guides[1]}\nJSON only: {"subject":"...","body":"..."}`);
  return parseJSON(text);
}

async function analyseLeadWithAI(lead) {
  const text = await callAI(`Score this lead 0-100 for a freelancer.\nLead: ${lead.name} | ${lead.description||lead.desc} | Source: ${lead.source||lead.src} | Budget: ${lead.budget_estimate||lead.budget}\nJSON only: {"score":<0-100>,"priority":"high|medium|low","reasoning":"<one sentence>","suggested_approach":"<one sentence>"}`);
  return parseJSON(text);
}

async function testAIConnection() {
  try {
    const provider = getProvider();
    logger.info(`Testing AI: ${provider}`);
    const text = await callAI('Reply with this exact JSON and nothing else: {"status":"ok"}');
    return { ok: true, provider, response: text.substring(0, 100) };
  } catch (err) {
    logger.error(`AI test failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { generateColdEmail, generateSkillAwareEmail, generateFollowUp, analyseLeadWithAI, testAIConnection };
