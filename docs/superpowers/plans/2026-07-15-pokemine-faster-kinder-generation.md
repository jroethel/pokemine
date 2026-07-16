# Pokemine: Faster, Kinder, Never-Empty Generation - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make card generation rarely fail and never empty-handed: fix the bridge deadline mismatch, stream create progress as themed Poke Ball phases over SSE, fall back to a placeholder-art card when the image fails, show kid-friendly errors in a styled box, log timing, and make the text model pluggable (Gemini default + anthropic/openai HTTP providers).

**Architecture:** Single Express server, no-build vanilla-JS frontend. `POST /api/pokemon` becomes an SSE-over-POST stream emitting `phase` / `done` / `error` events; the frontend drives a Poke Ball overlay from them and never uses `alert()`. Text gen is abstracted behind a Node provider registry (`lib/text-providers.js`) cloned from the image-provider pattern. The Brave bridge extension reads a server-supplied deadline instead of its hardcoded 120s. Pure Node, zero new dependencies.

**Tech Stack:** Node >=20.6 (global `fetch`, `node:test`, `--env-file`, `ReadableStream`), Express 4, Sharp, vanilla JS, Chrome MV3 extension.

## Global Constraints

- No new npm dependencies - use global `fetch`, `node:test`, `ReadableStream`.
- No em dashes (`—`) and no section symbols (`§`) anywhere in UI copy; use `-`.
- Never bind port 3000 in scratch/CI; tests start the app on an ephemeral port via `app.listen(0)`.
- Default text provider stays `gemini` (Gemini Flash); nothing may depend on Anthropic access ending 2026-08-05 - the anthropic provider's base URL defaults to `https://api.z.ai/api/anthropic`, never `api.anthropic.com`.
- Preserve the 63x88mm print layout (art flex-shrinks at print); do not regress print SPILL.
- All existing tests stay green; new tests added via `node --test test/*.test.js`.
- Errors reach the UI only through a styled `#error-box`, never raw `alert()`.
- Each test file sets `process.env.DATA_DIR` to a fresh tmpdir at the top before requiring modules (the runner isolates files into separate processes).

## Reference tables (from the brainstorm spec)

**Poke Ball phases**

| phase | ball        | kid message                        |
|-------|-------------|------------------------------------|
| text  | Poke Ball   | Sending your idea to the Professor |
| image | Ultra Ball  | Drawing your Pokemon...            |
| done  | Master Ball | (success flourish)                 |

**Kid-friendly error map** (signature -> title / body)

| signature (substring, case-insensitive) | title                | body                                                                  |
|-----------------------------------------|----------------------|-----------------------------------------------------------------------|
| `art-failed`                            | Caught it... almost! | We got the card, but the picture got away. Tap Redraw to try again.   |
| `timed out` / `no image appeared`       | It got away!         | That Pokemon took too long to show up. Let's try again!               |
| `overloaded` / `429` / `503`            | The lab is busy      | Professor Oak's computers are swamped. Wait a sec and try again.      |
| `bridge-offline` / `driver offline`     | Helper not connected | Ask a grown-up to open gemini.google.com in Brave with the Bridge.    |
| `quota` / `permission_denied` / billing | Out of pokeballs     | We've made a lot today! Try again tomorrow or ask a grown-up.         |
| (fallback)                              | Hmm, that's weird    | Something goofed. Try again!                                          |

---

## Task 1: Pluggable text provider registry

**Files:**
- Create: `lib/text-providers.js`
- Modify: `lib/text.js:54-82` (`callJSON` delegates to the registry; add opts threading)
- Modify: `lib/text.js:134-142` (`newPokemon` passes opts)
- Modify: `server.js:114-126` (expose `textProvider` + `textProviders` in `/api/config`)
- Modify: `server.js:172-188` (create handler passes `textProvider` through)
- Modify: `.env.example`
- Test: `test/text-providers.test.js`

**Interfaces:**
- Produces: `lib/text-providers.js` exports `{ getTextProvider(name?), listTextProviders(), providers }` where each provider is `{ async complete({ system, user }) -> string }`.
- `lib/text.js` `callJSON(prompt, opts)` now calls `getTextProvider(opts?.textProvider).complete(...)` and `JSON.parse`s the returned string; `newPokemon(userPrompt, opts)` threads opts to `callJSON`.

- [ ] **Step 1: Write the failing test**

Create `test/text-providers.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');

const originalFetch = global.fetch;
const restore = () => { global.fetch = originalFetch; };

test('gemini: sends system+user, returns candidate text', async () => {
  process.env.GEMINI_API_KEY = 'k';
  const { providers } = require('../lib/text-providers');
  let sent;
  global.fetch = async (url, opts) => { sent = { url, body: JSON.parse(opts.body) };
    return { json: async () => ({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }) }; };
  const out = await providers.gemini.complete({ system: 's', user: 'u' });
  assert.equal(out, '{"a":1}');
  assert.equal(sent.body.system_instruction.parts[0].text, 's');
  assert.equal(sent.body.contents[0].parts[0].text, 'u');
  restore();
});

test('gemini: throws on body.error', async () => {
  const { providers } = require('../lib/text-providers');
  global.fetch = async () => ({ json: async () => ({ error: { message: 'nope' } }) });
  await assert.rejects(() => providers.gemini.complete({ system: 's', user: 'u' }), /gemini text: nope/);
  restore();
});

test('anthropic: posts to z.ai default with x-api-key + version, returns content[0].text', async () => {
  process.env.ANTHROPIC_BASE_URL = 'https://api.z.ai/api/anthropic';
  process.env.ANTHROPIC_API_KEY = 'zk';
  const { providers } = require('../lib/text-providers');
  let sent;
  global.fetch = async (url, opts) => { sent = { url, headers: opts.headers, body: JSON.parse(opts.body) };
    return { json: async () => ({ content: [{ text: '{"b":2}' }] }) }; };
  const out = await providers.anthropic.complete({ system: 's', user: 'u' });
  assert.equal(out, '{"b":2}');
  assert.equal(sent.url, 'https://api.z.ai/api/anthropic/v1/messages');
  assert.equal(sent.headers['x-api-key'], 'zk');
  assert.equal(sent.headers['anthropic-version'], '2023-06-01');
  assert.equal(sent.body.model, 'glm-4.7');
  restore();
});

test('anthropic: throws on error envelope', async () => {
  const { providers } = require('../lib/text-providers');
  global.fetch = async () => ({ json: async () => ({ type: 'error', error: { message: 'rate limited' } }) });
  await assert.rejects(() => providers.anthropic.complete({ system: 's', user: 'u' }), /text \(anthropic\): rate limited/);
  restore();
});

test('openai: returns choices[0].message.content', async () => {
  const { providers } = require('../lib/text-providers');
  global.fetch = async () => ({ json: async () => ({ choices: [{ message: { content: '{"c":3}' } }] }) });
  const out = await providers.openai.complete({ system: 's', user: 'u' });
  assert.equal(out, '{"c":3}');
  restore();
});

test('getTextProvider defaults to gemini, honors name + env', () => {
  const { getTextProvider } = require('../lib/text-providers');
  assert.ok(getTextProvider().complete);
  assert.ok(getTextProvider('openai').complete);
  process.env.TEXT_PROVIDER = 'anthropic';
  assert.ok(getTextProvider().complete);
  delete process.env.TEXT_PROVIDER;
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/text-providers.test.js`
Expected: FAIL - `Cannot find module '../lib/text-providers.js'`.

- [ ] **Step 3: Create `lib/text-providers.js`**

```js
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
```

- [ ] **Step 4: Delegate `lib/text.js` `callJSON` to the registry**

In `lib/text.js`, require the registry near the top (after the `fs` require):

```js
const { getTextProvider } = require('./text-providers');
```

Replace the body of `callJSON` (`lib/text.js:54-77`) so it calls the provider and parses the returned string, retrying only on parse failure (preserving the existing 3-attempt behavior; real API errors still propagate immediately):

```js
async function callJSON(prompt, opts = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await getTextProvider(opts.textProvider).complete({ system: buildSystem(), user: prompt });
    try {
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
```

Thread opts through `newPokemon` (`lib/text.js:134-142`):

```js
function newPokemon(userPrompt, opts = {}) {
  return withValidationRetry(async () => {
    const data = await callJSON(
      `A kid wants a new Pokemon: "${userPrompt}".
Invent stage 1 of it. Reply with JSON: ${stageShape(1, null)}`, opts);
    validateStage(data);
    return clampStage(data, 1, null);
  });
}
```

Leave `extractJSON` exported (still works on a Gemini envelope) for back-compat.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/text-providers.test.js`
Expected: PASS (all 6 tests).

- [ ] **Step 6: Expose text provider in config + thread it through create**

Add a require for the text-provider list near the `text` require at the top of `server.js` (`server.js:6`). (Do not touch the image-providers destructure on line 7 - `listTextProviders` comes from the text registry, not `lib/providers.js`.)

```js
const { listTextProviders } = require('./lib/text-providers');
```

In `/api/config` (`server.js:114-126`), add inside the `res.json({ ... })`:

```js
    textProvider: process.env.TEXT_PROVIDER || 'gemini',
    textProviders: listTextProviders(),
```

In `POST /api/pokemon` (`server.js:172-188`), pass the client-chosen text provider through. Change the `text.newPokemon` call:

```js
  const { prompt, provider = DEFAULT_PROVIDER, trainer, textProvider } = req.body;
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Type an idea first!' });
  const stage = await text.newPokemon(prompt.trim(), { textProvider });
```

(Task 3 rewrites the rest of this handler; keep this `textProvider` threading intact.)

- [ ] **Step 7: Update `.env.example`**

Append:

```
TEXT_PROVIDER=gemini
ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
ANTHROPIC_API_KEY=
ANTHROPIC_TEXT_MODEL=glm-4.7
OPENAI_BASE_URL=https://api.z.ai/api/paas/v4
OPENAI_API_KEY=
OPENAI_TEXT_MODEL=glm-4.7
```

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS (existing 21 + new 6, no regressions).

- [ ] **Step 9: Commit**

```bash
git add lib/text-providers.js lib/text.js server.js .env.example test/text-providers.test.js
git commit -m "feat(text): pluggable text provider registry (gemini/anthropic/openai via fetch)"
```

---

## Task 2: Bridge deadline + detection (the actual timeout fix)

**Files:**
- Modify: `lib/providers.js:85-104` (write `timeoutMs` into the job file via a new `writeBridgeJob` helper; export `PIXEL`, `providers`, `writeBridgeJob`)
- Modify: `server.js:77-93` (serve `timeoutMs` from `/api/bridge/jobs`)
- Modify: `bridge-extension/content.js:26,46-54,65-81` (server-driven deadline, faster poll, `complete` guard)
- Test: `test/bridge-reliability.test.js`

**Interfaces:**
- Produces: `writeBridgeJob(dir, prompt) -> id` writes `{id, prompt, createdAt, timeoutMs}` and returns the id; `bridge.generate()` uses it. Exports `PIXEL` and the `providers` registry (for test stubbing and the Task 3 placeholder).
- Consumes: the extension reads `job.timeoutMs` and passes it to `waitForNewImage`.

- [ ] **Step 1: Write the failing test**

Create `test/bridge-reliability.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokemine-bridge-'));

test('writeBridgeJob embeds a server-driven timeoutMs', () => {
  process.env.BRIDGE_TIMEOUT_MS = '300000';
  const { writeBridgeJob, bridgeJobsDir } = require('../lib/providers');
  const id = writeBridgeJob(bridgeJobsDir(), 'a creature');
  const job = JSON.parse(fs.readFileSync(path.join(bridgeJobsDir(), `${id}.json`), 'utf8'));
  assert.equal(job.timeoutMs, 295000); // 300000 - 5000 buffer
  assert.match(job.prompt, /a creature/);
});

test('PIXEL is a real PNG buffer (placeholder for art-failed)', () => {
  const { PIXEL } = require('../lib/providers');
  assert.ok(Buffer.isBuffer(PIXEL) && PIXEL.length > 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/bridge-reliability.test.js`
Expected: FAIL - `writeBridgeJob is not a function` (and `PIXEL` undefined).

- [ ] **Step 3: Add `writeBridgeJob` + exports in `lib/providers.js`**

In the `bridge.generate()` body (`lib/providers.js:82-87`), replace the inline id + write with a call to a new helper. First add the helper above the `providers` object (after `stub`):

```js
// Server-driven deadline: the extension honors this instead of its own hardcoded wait.
function writeBridgeJob(dir, prompt) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const timeoutMs = +(process.env.BRIDGE_TIMEOUT_MS || 300000) - 5000; // extension reports before the server times out
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({
    id, prompt: `${prompt}\nSquare image, 1:1 aspect ratio.`, createdAt: new Date().toISOString(), timeoutMs,
  }));
  return id;
}
```

Replace the job-creation lines inside `bridge.generate()` (the `const id = ...` and `fs.writeFileSync(p('json'), ...)` lines, `:83-87`) with:

```js
      const dir = bridgeJobsDir();
      const id = writeBridgeJob(dir, prompt);
      const p = ext => path.join(dir, `${id}.${ext}`);
      const cleanup = () => { for (const e of ['json', 'png', 'jpg', 'error']) fs.rmSync(p(e), { force: true }); };
```

Update the exports (`lib/providers.js:138`):

```js
module.exports = { getProvider, withContinuity, listProviders, extFor, bridgeJobsDir, PIXEL, writeBridgeJob, providers };
```

- [ ] **Step 4: Serve `timeoutMs` from `/api/bridge/jobs`**

In `server.js:77-93`, change the job read to include `timeoutMs`:

```js
      const { prompt, timeoutMs } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      jobs.push({ id, prompt, timeoutMs });
```

- [ ] **Step 5: Update `bridge-extension/content.js`**

Replace `bigImages` (`:26`) to require the image to be decoded:

```js
const bigImages = () => [...document.querySelectorAll('img')].filter(im => im.complete && im.naturalWidth > 200);
```

Replace `waitForNewImage` (`:46-54`) with a server-driven deadline and faster poll:

```js
async function waitForNewImage(baseline, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 280000);
  while (Date.now() < deadline) {
    await sleep(1500);
    const imgs = bigImages();
    if (imgs.length > baseline) return imgs[imgs.length - 1]; // newest is the result
  }
  throw new Error('no image appeared within the deadline');
}
```

Pass the job's deadline through in `runJob` (`:73`):

```js
    const img = await waitForNewImage(baseline, job.timeoutMs);
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test test/bridge-reliability.test.js`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS (no regressions).

- [ ] **Step 8: Commit**

```bash
git add lib/providers.js server.js bridge-extension/content.js test/bridge-reliability.test.js
git commit -m "fix(bridge): server-driven deadline replaces hardcoded 120s; poll 1.5s; detect decoded images"
```

---

## Task 3: SSE create handler + mockup fallback + timing log + bridge-offline guard

**Files:**
- Modify: `server.js:7` (import `PIXEL`), `:172-188` (rewrite create handler), add `logGeneration` helper + `SSE` writer + `PHASES`
- Test: `test/create-sse.test.js`

**Interfaces:**
- Produces: `POST /api/pokemon` streams `text/event-stream`. Events: `phase {name, ball, msg}`, `done {record, seconds, warning?}`, `error {message}`. On image failure it still persists the record with the `PIXEL` placeholder and emits `done` with `warning: "art-failed"`. Appends a line to `<DATA_DIR>/generation.log`. A bridge provider with a disconnected driver (`bridge.lastSeen` stale) returns HTTP 400 `{error:'bridge-offline'}` before streaming.
- Consumes: Task 1's `text.newPokemon(prompt, {textProvider})`; Task 2's `PIXEL` + `providers` exports.

- [ ] **Step 1: Write the failing test**

Create `test/create-sse.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokemine-sse-'));
process.env.DEFAULT_IMAGE_PROVIDER = 'mock';

const app = require('../server');
const text = require('../lib/text');
const providerMod = require('../lib/providers');

text.newPokemon = async () => ({
  name: 'Testymon', category: 'The Testing Pokemon', types: ['normal'], hp: 70, flavor: 'f',
  moves: [{ name: 'Tackle', damage: 30, text: 'bop' }], artPrompt: 'a blob', description: 'd', backstory: 'b',
});

async function createBody(body) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/api/pokemon`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, text: await res.text() };
  } finally { server.close(); }
}

function parseEvents(text) {
  return text.split('\n\n').filter(Boolean).map(block => {
    const ev = {};
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) ev.event = line.slice(7);
      if (line.startsWith('data: ')) ev.data = JSON.parse(line.slice(6));
    }
    return ev;
  });
}

test('create streams text -> image -> done and logs ok', async () => {
  const { text } = await createBody({ prompt: 'a blob', provider: 'mock' });
  const events = parseEvents(text);
  assert.equal(events[0].event, 'phase'); assert.equal(events[0].data.name, 'text');
  assert.equal(events[1].event, 'phase'); assert.equal(events[1].data.name, 'image');
  assert.equal(events[2].event, 'done');
  assert.ok(events[2].data.record.id);
  assert.ok(events[2].data.seconds >= 0);
  assert.match(fs.readFileSync(path.join(process.env.DATA_DIR, 'generation.log'), 'utf8'), /outcome=ok/);
});

test('image failure -> done with art-failed and placeholder saved', async () => {
  const original = providerMod.providers.mock;
  providerMod.providers.mock = { real: true, supportsReference: false,
    async generate() { throw new Error('bridge: timed out after 5 minutes'); } };
  try {
    const { text } = await createBody({ prompt: 'a blob', provider: 'mock' });
    const done = parseEvents(text).find(e => e.event === 'done');
    assert.equal(done.data.warning, 'art-failed');
    assert.ok(done.data.record.id);
    assert.match(fs.readFileSync(path.join(process.env.DATA_DIR, 'generation.log'), 'utf8'), /outcome=art-failed/);
  } finally { providerMod.providers.mock = original; }
});

test('text failure -> error event, no done', async () => {
  const original = text.newPokemon;
  text.newPokemon = async () => { throw new Error('gemini text: overloaded'); };
  try {
    const { text: body } = await createBody({ prompt: 'a blob', provider: 'mock' });
    const events = parseEvents(body);
    assert.ok(events.some(e => e.event === 'error' && /overloaded/.test(e.data.message)));
    assert.ok(!events.some(e => e.event === 'done'));
  } finally { text.newPokemon = original; }
});

test('bridge offline -> 400 bridge-offline, no stream', async () => {
  const { status, text } = await createBody({ prompt: 'x', provider: 'bridge' });
  assert.equal(status, 400);
  assert.match(JSON.parse(text).error, /bridge-offline/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/create-sse.test.js`
Expected: FAIL - the current handler returns one JSON blob; events won't parse / `art-failed` absent.

- [ ] **Step 3: Add helpers and rewrite the create handler in `server.js`**

Import `PIXEL` (update line 7):

```js
const { getProvider, withContinuity, listProviders, extFor, bridgeJobsDir, PIXEL } = require('./lib/providers');
```

Add helpers above `app.post('/api/pokemon', ...)` (near line 171):

```js
const SSE = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const PHASES = {
  text:  { name: 'text',  ball: 'poke',  msg: 'Sending your idea to the Professor...' },
  image: { name: 'image', ball: 'ultra', msg: 'Drawing your Pokemon...' },
};

function logGeneration({ id = '-', provider, t0, textMs, imageMs, outcome }) {
  const line = `${new Date().toISOString()} id=${id} provider=${provider} textMs=${textMs ?? '-'} imageMs=${imageMs ?? '-'} totalMs=${Date.now() - t0} outcome=${outcome}\n`;
  fs.appendFileSync(path.resolve(DATA_DIR, 'generation.log'), line);
}
```

Replace the entire `app.post('/api/pokemon', wrap(async (req, res) => { ... }))` block (`server.js:172-188`) with:

```js
app.post('/api/pokemon', wrap(async (req, res) => {
  const { prompt, provider = DEFAULT_PROVIDER, trainer, textProvider } = req.body;
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Type an idea first!' });
  // Fail fast instead of a 5-minute hang when the browser driver isn't connected.
  if (provider === 'bridge' && Date.now() - bridge.lastSeen >= 15000) {
    return res.status(400).json({ error: 'bridge-offline' });
  }

  res.set('Content-Type', 'text/event-stream');
  res.set('Cache-Control', 'no-cache');
  res.set('Connection', 'keep-alive');

  const t0 = Date.now();
  let stage, textMs;
  try {
    SSE(res, 'phase', PHASES.text);
    const tText = Date.now();
    stage = await text.newPokemon(prompt.trim(), { textProvider });
    textMs = Date.now() - tText;
  } catch (e) {
    SSE(res, 'error', { message: e.message });
    logGeneration({ provider, t0, textMs, outcome: 'error' });
    return res.end();
  }

  const { artPrompt, ...stageData } = stage;
  let art, outcome = 'ok', warning, imageMs;
  const tImg = Date.now();
  try {
    SSE(res, 'phase', PHASES.image);
    art = await autocrop(await getProvider(provider).generate({
      prompt: `${withContinuity(provider, artPrompt, '')}\nThe kid asked for: ${prompt.trim()}.`,
    }));
    logCost(provider);
  } catch (e) {
    art = { data: PIXEL, mime: 'image/png' }; // placeholder; Redraw retries the picture
    outcome = 'art-failed'; warning = 'art-failed';
  }
  imageMs = Date.now() - tImg;

  const record = store.create({
    ...(trainer ? { createdBy: trainer } : {}),
    stages: [{ ...stageData, prompt: prompt.trim(), art: null }],
  });
  record.stages[0].art = store.saveArt(record.id, `stage-1.${extFor(art.mime)}`, art.data);
  store.save(record);
  logGeneration({ id: record.id, provider, t0, textMs, imageMs, outcome });
  SSE(res, 'done', { record, seconds: (Date.now() - t0) / 1000, ...(warning ? { warning } : {}) });
  res.end();
}));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/create-sse.test.js`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add server.js test/create-sse.test.js
git commit -m "feat(create): SSE phases, art-failed mockup fallback, timing log, bridge-offline guard"
```

---

## Task 4: Kid-friendly error mapper + styled error box

**Files:**
- Create: `public/friendly-errors.js`
- Modify: `public/index.html` (add `#error-box` + script tag)
- Modify: `public/app.js:45-58` (`showError()`, replace `alert` in `generating()`)
- Modify: `public/style.css` (add `#error-box` styles)
- Test: `test/friendly-errors.test.js`

**Interfaces:**
- Produces: `friendlyError(msg) -> { title, body }`, exposed as `window.friendlyError` (browser) and `module.exports` (node test). `showError(msg)` in `app.js` renders it into `#error-box`.

- [ ] **Step 1: Write the failing test**

Create `test/friendly-errors.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { friendlyError } = require('../public/friendly-errors');

test('art-failed -> Caught it... almost!', () => {
  assert.match(friendlyError('art-failed').title, /almost/);
});
test('timeout -> It got away!', () => {
  assert.match(friendlyError('bridge: timed out after 5 minutes').title, /got away/);
});
test('overloaded -> The lab is busy', () => {
  assert.match(friendlyError('gemini text: 503 overloaded').title, /lab is busy/);
});
test('bridge-offline -> Helper not connected', () => {
  assert.match(friendlyError('bridge-offline').title, /not connected/i);
});
test('quota -> Out of pokeballs', () => {
  assert.match(friendlyError('PERMISSION_DENIED: quota exceeded').title, /pokeballs/i);
});
test('unknown -> generic fallback', () => {
  assert.match(friendlyError('something unprecedented').title, /weird/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/friendly-errors.test.js`
Expected: FAIL - `Cannot find module '../public/friendly-errors.js'`.

- [ ] **Step 3: Create `public/friendly-errors.js`**

```js
// Pure kid-friendly error mapper. No DOM references, so it is unit-testable in node.
// Order matters: art-failed before timeout (a successful-but-imageless card is friendlier than "got away").
const RULES = [
  { match: /art-failed/i, title: 'Caught it... almost!',
    body: "We got the card, but the picture got away. Tap Redraw to try the picture again." },
  { match: /timed out|no image appeared/i, title: 'It got away!',
    body: "That Pokemon took too long to show up. Let's try again!" },
  { match: /overloaded|429|503|rate limit/i, title: 'The lab is busy',
    body: "Professor Oak's computers are swamped. Wait a sec and try again." },
  { match: /bridge-offline|driver offline|driver not connected/i, title: 'Helper not connected',
    body: 'Ask a grown-up to open gemini.google.com in Brave with the Bridge extension.' },
  { match: /quota|permission_denied|billing/i, title: 'Out of pokeballs',
    body: "We've made a lot today! Try again tomorrow or ask a grown-up." },
];

function friendlyError(msg) {
  const hit = RULES.find(r => r.match.test(String(msg || '')));
  return hit || { title: "Hmm, that's weird", body: 'Something goofed. Try again!' };
}

if (typeof module !== 'undefined') module.exports = { friendlyError, RULES };
if (typeof window !== 'undefined') window.friendlyError = friendlyError;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/friendly-errors.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the error box to `public/index.html`**

Add this modal near the existing `#loading` overlay:

```html
<div id="error-box" class="error-box hidden">
  <div class="error-card">
    <h2 id="error-box-title"></h2>
    <p id="error-box-body"></p>
    <button id="error-box-ok" class="big">OK</button>
  </div>
</div>
```

Add the script tag before the `app.js` script tag:

```html
<script src="friendly-errors.js"></script>
```

- [ ] **Step 6: Add `showError()` and replace `alert()` in `public/app.js`**

Add `showError` near `showLoading` (after `hideLoading`, `app.js:33`):

```js
function showError(msg) {
  const { title, body } = window.friendlyError(msg);
  $('#error-box-title').textContent = title;
  $('#error-box-body').textContent = body;
  $('#error-box').classList.remove('hidden');
}
```

In `generating()` (`app.js:45-58`), replace `alert(e.message);` with `showError(e.message);`.

Wire the OK button once at load (add near the bottom, before `route();`):

```js
const errorOk = $('#error-box-ok');
if (errorOk) errorOk.onclick = () => $('#error-box').classList.add('hidden');
```

- [ ] **Step 7: Add `#error-box` styles to `public/style.css`**

```css
.error-box { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.error-box.hidden { display: none; }
.error-card { background: #fff; border-radius: 14px; padding: 28px 32px; max-width: 360px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,.4); }
.error-card h2 { margin: 0 0 8px; color: #cc0000; }
.error-card p { margin: 0 0 20px; color: #333; }
```

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS (no regressions).

- [ ] **Step 9: Commit**

```bash
git add public/friendly-errors.js public/index.html public/app.js public/style.css test/friendly-errors.test.js
git commit -m "feat(ui): kid-friendly error box replaces raw alert"
```

---

## Task 5: SSE client + phase Poke Ball overlay + text provider selector

**Files:**
- Modify: `public/app.js` (streaming `createPokemon`, `setPhase`, create click handler, text-provider select)
- Modify: `public/index.html` (ensure `#loading .pokeball` exists - already present)
- Modify: `public/style.css` (`.pokeball.ultra`, `.pokeball.master`)
- Verify: manual/E2E (browser code)

**Interfaces:**
- Consumes: Task 3's SSE event stream; Task 4's `showError`; Task 1's `/api/config` `textProviders`/`textProvider`.

- [ ] **Step 1: Add Poke Ball variants to `public/style.css`**

Near the existing `.pokeball` rule (`style.css:239-257`), add:

```css
.pokeball.ultra  { background: linear-gradient(#1a1a1a 0 20%, #2b2b2b 20% 30%, #eec900 30% 40%, #2b2b2b 40% 50%, #f4f4f4 50% 100%); }
.pokeball.master { background: linear-gradient(#5b2a86 50%, #f4f4f4 50%); }
```

- [ ] **Step 2: Add `setPhase` + streaming `createPokemon` to `public/app.js`**

Add after `hideLoading` (`app.js:33`):

```js
function setPhase(ball, msg) {
  if (msgTimer) { clearInterval(msgTimer); msgTimer = null; }
  const el = $('#loading .pokeball');
  el.className = 'pokeball' + (ball && ball !== 'poke' ? ' ' + ball : '');
  $('#loading-msg').textContent = msg;
}

async function createPokemon(prompt, provider, trainer, textProvider) {
  const res = await fetch('/api/pokemon', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, provider, trainer, textProvider }),
  });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Something went wrong'); }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', record, warning, errMsg;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
      let evt = 'message', data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) evt = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (evt === 'phase') { const p = JSON.parse(data); setPhase(p.ball, p.msg); }
      else if (evt === 'done') { const d = JSON.parse(data); record = d.record; warning = d.warning; }
      else if (evt === 'error') { errMsg = JSON.parse(data).message; }
    }
  }
  if (errMsg) throw new Error(errMsg);
  return { record, warning };
}
```

- [ ] **Step 3: Rewire the create click handler to stream + theme**

Replace the `$('#go').onclick` block in `viewCreate()` (`app.js:200-206`) with:

```js
  $('#go').onclick = async () => {
    const prompt = $('#prompt').value;
    if (!prompt.trim()) return;
    showLoading();
    try {
      const { record, warning } = await createPokemon(prompt, currentProvider(), localStorage.trainer, currentTextProvider());
      config = await api('/config').catch(() => config);
      updateCostBadge();
      location.hash = `#card/${record.id}`;
      if (warning) showError('art-failed'); // card saved with placeholder; nudge a Redraw
    } catch (e) {
      showError(e.message);
    } finally {
      hideLoading();
    }
  };
```

- [ ] **Step 4: Add the "words by" text-provider selector**

Add a helper near `currentProvider()` (`app.js:60`):

```js
function currentTextProvider() {
  return localStorage.textProvider || config.textProvider || 'gemini';
}
```

In `viewCreate()`, render the selector next to the art one. After the `${providerSelect()}` line in the create-body template, add:

```js
        ${config.textProviders && config.textProviders.length > 1 ? textProviderSelect() : ''}
```

Add the builder near `providerSelect()` (`app.js:102`):

```js
function textProviderSelect() {
  const opts = (config.textProviders || []).map(p =>
    `<option value="${p}" ${p === currentTextProvider() ? 'selected' : ''}>${p}</option>`).join('');
  return `<label class="provider no-print">words by
    <select id="text-provider">${opts}</select></label>`;
}
```

Bind it in `viewCreate()` (after `bindProviderSelect();`):

```js
  const tsel = $('#text-provider');
  if (tsel) tsel.onchange = () => { localStorage.textProvider = tsel.value; };
```

- [ ] **Step 5: Manual E2E (mock provider, no bridge needed)**

Start off-port: `PORT=3311 DATA_DIR=/tmp/pokemine-scratch node --env-file=.env server.js`
Open `http://localhost:3311`, pick art provider `mock`, type an idea, click Generate.
Expected: red overlay shows Poke Ball ("Sending your idea to the Professor..."), then Ultra Ball ("Drawing your Pokemon..."), then navigates to a rendered card; `generation.log` has an `outcome=ok` line.

- [ ] **Step 6: Manual E2E (art-failed path)**

With the server up, set a bad Gemini key in `.env` (or temporarily make `mock` throw), generate again.
Expected: overlay phases run, then the card appears with blank placeholder art and the friendly "Caught it... almost!" box; Redraw retries the picture; `generation.log` shows `outcome=art-failed`.

- [ ] **Step 7: Manual E2E (bridge, real)**

Load the Bridge extension in Brave, open a signed-in `gemini.google.com` tab, pick art provider `bridge`, generate.
Expected: a generation that takes longer than 120s now succeeds (deadline is server-driven); with the extension/tab closed, Generate fails fast with the "Helper not connected" box instead of a 3-minute hang.

- [ ] **Step 8: Run the full suite + commit**

Run: `npm test`
Expected: PASS (no regressions).

```bash
git add public/app.js public/style.css public/index.html
git commit -m "feat(ui): SSE-driven Poke Ball phase overlay (Poke->Ultra->Master) + words-by selector"
```

---

## Verification (end-to-end, after all tasks)

1. `npm test` - existing 21 + new tests (text-providers, bridge-reliability, create-sse, friendly-errors) all green.
2. Create on `mock`: phases fire Poke Ball -> Ultra Ball -> Master Ball; card renders; `generation.log` `outcome=ok`.
3. Simulated image failure: `done` with `art-failed`, card renders with placeholder, Redraw retries the picture, log says `art-failed`, friendly "Caught it... almost!" box.
4. Text error (bad key / overloaded): `error` event -> friendly "The lab is busy" box, no orphan card.
5. Real bridge: >120s generation succeeds; disconnected driver fails fast with "Helper not connected".
6. Text provider: `TEXT_PROVIDER=anthropic` (or pick in the "words by" select) pointing `.env` at z.ai `glm-4.7`; create a card; well-formed JSON + card; compare latency in `generation.log` vs Gemini Flash.

## Risks

- **2026-08-05 Anthropic access:** providers use raw HTTP, so no SDK/runtime dependency. The only risk is a backend default pointed at `api.anthropic.com` (would break post-08-05); `.env.example` defaults both at z.ai / OpenAI-compatible endpoints, with real Anthropic/OpenAI opt-in via `.env`.
- **SSE-over-POST on the Chromebook client:** streaming a POST body via `fetch` + `getReader()` works in Chrome/Chromium; verify on the actual Chromebook in Task 5 Step 5. If blocked: fall back to the existing blocking JSON path behind a flag (phases lost, but mockup/errors/timing remain).
- **Bridge detection brittleness:** the count + `naturalWidth>200` + `complete` heuristic is the weak point if Gemini's DOM changes; the deadline fix removes the current failure, but detection is the thing to watch. Playwright stays the fallback if detection is still flaky after these fixes (deferred per the user's decision).
- **`art-failed` placeholder look:** a 1x1 transparent PNG renders as an empty art window; acceptable behind the friendly warning + Redraw, but a themed "coming soon" placeholder image is a natural follow-up.
