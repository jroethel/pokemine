const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./lib/store');
const text = require('./lib/text');
const { getProvider, withContinuity, listProviders, extFor, bridgeJobsDir } = require('./lib/providers');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || './data';
const DEFAULT_PROVIDER = process.env.DEFAULT_IMAGE_PROVIDER || 'gemini';

store.init(DATA_DIR);

const app = express();
app.use(express.json({ limit: '8mb' })); // bridge result payloads carry ~1-2MB base64 images
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(store.root()));

// CORS + Private Network Access on the bridge endpoints, so page-context drivers
// (a script running on gemini.google.com, not just the extension service worker)
// can fulfill jobs against this LAN server.
app.use('/api/bridge', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const wrap = fn => (req, res, next) => fn(req, res).catch(next);

const mimeFor = f => f.endsWith('.png') ? 'image/png' : f.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

// Browser driver bridge: the extension can't read local files, so it polls these
// HTTP endpoints and posts results back. Jobs are claimed in-memory so two polling
// drivers don't double-run one; a claim older than 150s frees up again.
const bridge = { lastSeen: 0, claims: new Map() };
const CLAIM_TTL = 150000;

app.get('/api/bridge/jobs', (req, res) => {
  const dir = bridgeJobsDir();
  const now = Date.now();
  const jobs = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    const claimedAt = bridge.claims.get(id);
    if (claimedAt && now - claimedAt < CLAIM_TTL) continue;
    try {
      const { prompt } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      jobs.push({ id, prompt });
      bridge.claims.set(id, now);
    } catch { /* half-written job file, pick it up next poll */ }
  }
  res.json(jobs);
});

app.post('/api/bridge/jobs/:id/result', (req, res) => {
  const { b64, mime } = req.body;
  const ext = mime === 'image/jpeg' || mime === 'image/jpg' ? 'jpg' : 'png';
  fs.writeFileSync(path.join(bridgeJobsDir(), `${req.params.id}.${ext}`), Buffer.from(b64, 'base64'));
  bridge.claims.delete(req.params.id);
  res.json({ ok: true });
});

app.post('/api/bridge/jobs/:id/error', (req, res) => {
  fs.writeFileSync(path.join(bridgeJobsDir(), `${req.params.id}.error`), String(req.body.message || 'driver error'));
  bridge.claims.delete(req.params.id);
  res.json({ ok: true });
});

app.post('/api/bridge/ping', (req, res) => {
  bridge.lastSeen = Date.now();
  res.json({ ok: true });
});

app.get('/api/config', (req, res) => {
  res.json({
    providers: listProviders(),
    default: DEFAULT_PROVIDER,
    bridge: { driverConnected: Date.now() - bridge.lastSeen < 15000, lastSeen: bridge.lastSeen || null },
  });
});

app.get('/api/pokemon', (req, res) => res.json(store.list()));
app.get('/api/pokemon/:id', (req, res) => res.json(store.get(req.params.id)));

app.post('/api/pokemon', wrap(async (req, res) => {
  const { prompt, provider = DEFAULT_PROVIDER } = req.body;
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Type an idea first!' });
  const { stage, backstory } = await text.newPokemon(prompt.trim());
  const { artPrompt, ...stageData } = stage;
  const art = await getProvider(provider).generate({
    prompt: withContinuity(provider, artPrompt, ''),
  });
  const record = store.create({
    backstory,
    stages: [{ ...stageData, prompt: prompt.trim(), art: null }],
  });
  record.stages[0].art = store.saveArt(record.id, `stage-1.${extFor(art.mime)}`, art.data);
  store.save(record);
  res.json(record);
}));

app.post('/api/pokemon/:id/evolve', wrap(async (req, res) => {
  const { provider = DEFAULT_PROVIDER } = req.body;
  const record = store.get(req.params.id);
  const prev = record.stages[record.stages.length - 1];
  const { artPrompt, ...stageData } = await text.evolvedStage(record);
  const p = getProvider(provider);
  const prompt = withContinuity(provider,
    `Evolve this creature. Its evolved form: ${artPrompt}
Same species, same color palette, same art style, clearly a bigger more powerful evolution.
The evolved form should look sturdier or sharper than before, same palette, keep one signature feature.`,
    prev.description);
  const reference = p.supportsReference
    ? { data: store.readArt(record.id, prev.art), mime: mimeFor(prev.art) }
    : undefined;
  const art = await p.generate({ prompt, reference });
  const n = record.stages.length + 1;
  record.stages.push({
    ...stageData, prompt: 'evolved',
    art: store.saveArt(record.id, `stage-${n}.${extFor(art.mime)}`, art.data),
  });
  store.save(record);
  res.json(record);
}));

app.post('/api/pokemon/:id/alter', wrap(async (req, res) => {
  const { instruction, stage: stageIndex, provider = DEFAULT_PROVIDER } = req.body;
  if (!instruction || !instruction.trim()) return res.status(400).json({ error: 'Say what to change!' });
  const record = store.get(req.params.id);
  const idx = stageIndex === undefined ? record.stages.length - 1 : stageIndex;
  const stage = record.stages[idx];
  const p = getProvider(provider);
  const prompt = withContinuity(provider,
    `${instruction.trim()}. Keep it the same creature, same cel-shaded Pokemon-style game art, full body, plain white background.`,
    stage.description);
  const reference = p.supportsReference
    ? { data: store.readArt(record.id, stage.art), mime: mimeFor(stage.art) }
    : undefined;
  const art = await p.generate({ prompt, reference });
  store.backupArt(record.id, stage.art);
  stage.art = store.saveArt(record.id, `stage-${idx + 1}.${extFor(art.mime)}`, art.data);
  // ponytail: naive continuity note; regenerate description via vision call if drift ever matters
  stage.description += ` Recently altered: ${instruction.trim()}.`;
  store.save(record);
  res.json(record);
}));

app.patch('/api/pokemon/:id', wrap(async (req, res) => {
  const { stage: stageIndex = 0, backstory, ...fields } = req.body;
  const record = store.get(req.params.id);
  const stage = record.stages[stageIndex];
  for (const k of ['name', 'hp', 'flavor', 'moves', 'category']) {
    if (fields[k] !== undefined) stage[k] = fields[k];
  }
  if (backstory !== undefined) record.backstory = backstory;
  store.save(record);
  res.json(record);
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'The Pokemon escaped! Try again!', detail: err.message });
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    const ip = Object.values(os.networkInterfaces()).flat()
      .find(i => i.family === 'IPv4' && !i.internal)?.address || 'localhost';
    console.log(`Pokemine running:
  Macbook:    http://localhost:${PORT}
  Chromebook: http://${ip}:${PORT}`);
  });
}

module.exports = app;
