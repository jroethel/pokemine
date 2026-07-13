// Image providers. Each: { real, supportsReference, generate({prompt, reference}) -> {data, mime} }
// reference = { data: Buffer, mime: string }

const fs = require('fs');
const path = require('path');

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
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:1' } },
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

  // Routes generation through the consumer Gemini web app via a browser driver (Brave
  // extension) that watches this job folder over the server's HTTP bridge endpoints.
  bridge: {
    real: true,
    supportsReference: false, // v1: withContinuity's description injection covers continuity
    async generate({ prompt }) {
      const dir = bridgeJobsDir();
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const p = ext => path.join(dir, `${id}.${ext}`);
      const cleanup = () => { for (const e of ['json', 'png', 'jpg', 'error']) fs.rmSync(p(e), { force: true }); };
      // Consumer Gemini has no aspect-ratio API; ask in the prompt instead.
      fs.writeFileSync(p('json'), JSON.stringify({ id, prompt: `${prompt}\nSquare image, 1:1 aspect ratio.`, createdAt: new Date().toISOString() }));

      const pollMs = +(process.env.BRIDGE_POLL_MS || 2000);
      // 300s: a real run on 2026-07-12 delivered its image at ~122s and lost the race
      // against the old 120s deadline (the result landed orphaned in bridge-jobs).
      const deadline = Date.now() + +(process.env.BRIDGE_TIMEOUT_MS || 300000);
      while (Date.now() < deadline) {
        await sleep(pollMs);
        for (const [ext, mime] of [['png', 'image/png'], ['jpg', 'image/jpeg']]) {
          if (fs.existsSync(p(ext))) { const data = fs.readFileSync(p(ext)); cleanup(); return { data, mime }; }
        }
        if (fs.existsSync(p('error'))) { const message = fs.readFileSync(p('error'), 'utf8'); cleanup(); throw new Error(`bridge: ${message}`); }
      }
      cleanup();
      throw new Error('bridge: timed out after 5 minutes waiting for the browser driver ' +
        '(open gemini.google.com in Brave with the Pokemine Bridge extension, signed in)');
    },
  },
  local: stub('local', 'future: Draw Things / Stable Diffusion on the Macbook'),
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function bridgeJobsDir() {
  const dir = path.resolve(process.env.DATA_DIR || './data', 'bridge-jobs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

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

module.exports = { getProvider, withContinuity, listProviders, extFor, bridgeJobsDir };
