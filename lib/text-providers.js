// Text (LLM) providers. Each: { async complete({ system, user }) -> string }.
// Mirrors lib/providers.js. Default stays gemini (Gemini Flash) so nothing breaks.

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

function extractText(env) {
  return (env.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
}

const providers = {
  gemini: {
    async complete({ system, user }) {
      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      });
      const body = await res.json();
      if (body.error) throw new Error(`gemini text: ${body.error.message}`);
      return extractText(body);
    },
  },

  anthropic: {
    async complete({ system, user }) {
      const base = process.env.ANTHROPIC_BASE_URL || 'https://api.z.ai/api/anthropic';
      const res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_TEXT_MODEL || 'glm-4.7',
          max_tokens: 2048,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      });
      const body = await res.json();
      if (body.type === 'error') throw new Error(`text (anthropic): ${body.error?.message || 'unknown'}`);
      return body.content?.[0]?.text || '';
    },
  },

  openai: {
    async complete({ system, user }) {
      const base = process.env.OPENAI_BASE_URL || 'https://api.z.ai/api/paas/v4';
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: process.env.OPENAI_TEXT_MODEL || 'glm-4.7',
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      });
      const body = await res.json();
      if (body.error) throw new Error(`text (openai): ${body.error.message || 'unknown'}`);
      return body.choices?.[0]?.message?.content || '';
    },
  },
};

function getTextProvider(name) {
  const p = providers[name || process.env.TEXT_PROVIDER || 'gemini'];
  if (!p) throw new Error(`unknown text provider: ${name || process.env.TEXT_PROVIDER}`);
  return p;
}

function listTextProviders() {
  return Object.keys(providers);
}

module.exports = { getTextProvider, listTextProviders, providers };
