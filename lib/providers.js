// Image providers. Each: { real, supportsReference, generate({prompt, reference}) -> {data, mime} }
// reference = { data: Buffer, mime: string }

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent';
const ZAI_URL = 'https://api.z.ai/api/paas/v4/images/generations';

// 1x1 transparent PNG so dev/tests cost nothing
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64');

function stub(name, seeAlso) {
  return {
    real: false,
    supportsReference: false,
    async generate() { throw new Error(`${name}: not implemented (${seeAlso})`); },
  };
}

const providers = {
  gemini: {
    real: true,
    supportsReference: true,
    async generate({ prompt, reference }) {
      const parts = [{ text: prompt }];
      if (reference) {
        parts.push({ inline_data: { mime_type: reference.mime, data: reference.data.toString('base64') } });
      }
      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '4:3' } },
        }),
      });
      const body = await res.json();
      if (body.error) throw new Error(`gemini: ${body.error.message}`);
      const img = body.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (!img) throw new Error('gemini: no image in response');
      return { data: Buffer.from(img.inlineData.data, 'base64'), mime: img.inlineData.mimeType };
    },
  },

  zai: {
    real: true,
    supportsReference: false,
    async generate({ prompt }) {
      const res = await fetch(ZAI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ZAI_API_KEY}` },
        body: JSON.stringify({ model: 'glm-image', prompt, size: '1024x1024' }),
      });
      const body = await res.json();
      if (body.error) throw new Error(`zai: ${body.error.message}`);
      // ponytail: response shape unverified until account has balance; handle both documented forms
      const item = body.data?.[0];
      if (item?.b64_json) return { data: Buffer.from(item.b64_json, 'base64'), mime: 'image/png' };
      if (item?.url) {
        const img = await fetch(item.url);
        return { data: Buffer.from(await img.arrayBuffer()), mime: img.headers.get('content-type') || 'image/png' };
      }
      throw new Error('zai: no image in response');
    },
  },

  mock: {
    real: true,
    supportsReference: true,
    async generate() { return { data: PIXEL, mime: 'image/png' }; },
  },

  bridge: stub('bridge', 'see docs/superpowers/specs/2026-07-12-plan-b-browser-bridge.md'),
  local: stub('local', 'future: Draw Things / Stable Diffusion on the Macbook'),
};

function getProvider(name) {
  const p = providers[name];
  if (!p) throw new Error(`unknown provider: ${name}`);
  return p;
}

// Providers without reference-image support keep visual continuity via the saved text description.
function withContinuity(providerName, prompt, description) {
  const p = getProvider(providerName);
  if (p.supportsReference || !description) return prompt;
  return `${prompt}\nThe creature looks like this: ${description}`;
}

function listProviders() {
  return Object.entries(providers).map(([name, p]) =>
    ({ name, real: p.real, supportsReference: p.supportsReference }));
}

function extFor(mime) {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
}

module.exports = { getProvider, withContinuity, listProviders, extFor };
