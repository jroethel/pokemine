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

// Cost tracking: in-memory session (resets on restart, ~ "today's play session")
// plus a persistent all-time ledger at <DATA_DIR>/costs.json.
const COST = { gemini: 0.034, zai: 0.014, bridge: 0, mock: 0, local: 0 }; // zai is an estimate
const costsPath = path.resolve(DATA_DIR, 'costs.json');
const session = { images: 0, cost: 0 };

function readLedger() {
  try {
    const l = JSON.parse(fs.readFileSync(costsPath, 'utf8'));
    return { images: l.images || 0, cost: l.cost || 0, byProvider: l.byProvider || {}, note: l.note };
  } catch (e) {
    if (e.code === 'ENOENT') return { images: 0, cost: 0, byProvider: {} };
    // Unreadable but present (e.g. a Drive streaming stall): never risk clobbering
    // the real ledger with a fresh one - callers must skip the write this round.
    console.warn(`costs.json unreadable (${e.message}); skipping ledger update to protect it`);
    return null;
  }
}

function logCost(provider) {
  const amt = COST[provider] || 0;
  session.images++;
  session.cost += amt;
  const ledger = readLedger();
  if (!ledger) return; // protect an unreadable ledger; session still counts
  ledger.images++;
  ledger.cost += amt;
  ledger.byProvider[provider] = (ledger.byProvider[provider] || 0) + 1;
  fs.writeFileSync(costsPath, JSON.stringify(ledger, null, 2));
}

const app = express();
app.use(express.json({ limit: '8mb' })); // bridge result payloads carry ~1-2MB base64 images
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(store.root()));
app.use('/avatars', express.static(store.trainersRoot()));

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

const NO_TEXT = "Do not write the creature's name or any text, letters, numbers, logos, or watermarks anywhere in the image.";

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
  // null = ledger temporarily unreadable (Drive stall); show zeros rather than erroring
  const ledger = readLedger() || { images: 0, cost: 0 };
  res.json({
    providers: listProviders(),
    default: DEFAULT_PROVIDER,
    bridge: { driverConnected: Date.now() - bridge.lastSeen < 15000, lastSeen: bridge.lastSeen || null },
    cost: {
      session: { images: session.images, cost: session.cost },
      total: { images: ledger.images, cost: ledger.cost },
    },
  });
});

const avatarUrl = t => (t.avatar ? `/avatars/${t.slug}/${t.avatar}` : null);

app.get('/api/trainers', (req, res) =>
  res.json(store.trainersList().map(t => ({ slug: t.slug, name: t.name, avatar: avatarUrl(t), createdAt: t.createdAt }))));

app.post('/api/trainers', wrap(async (req, res) => {
  const { name, description = '', provider = DEFAULT_PROVIDER } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Type a trainer name first!' });
  const profile = store.trainerCreate({ name: name.trim(), description: description.trim() });
  // Avatar art and backstory are independent; run them together (art is the long pole).
  const [art, lore] = await Promise.all([
    getProvider(provider).generate({
      prompt: `Pokemon trainer portrait: ${description.trim()}. Friendly bust portrait, cel-shaded Ken Sugimori watercolor style, plain white background. Do not write any text, letters, numbers, logos, or watermarks in the image.`,
    }),
    text.trainerBackstory({ name: name.trim(), description: description.trim() })
      .catch(() => null), // lore is a nice-to-have; never fail trainer creation over it
  ]);
  logCost(provider);
  const avatar = store.trainerSaveAvatar(profile.slug, `avatar.${extFor(art.mime)}`, art.data);
  if (lore) store.trainerSave(profile.slug, { ...profile, ...lore });
  res.json({ slug: profile.slug, name: profile.name, ...(lore || {}), avatar: `/avatars/${profile.slug}/${avatar}`, createdAt: profile.createdAt });
}));

app.get('/api/trainers/:slug', wrap(async (req, res) => {
  let t = store.trainerGet(req.params.slug);
  if (!t.backstory) { // trainers made before profiles existed: backfill once, persist
    try {
      const lore = await text.trainerBackstory(t);
      t = store.trainerSave(t.slug, { ...t, ...lore });
    } catch { /* show what we have; next visit retries */ }
  }
  res.json({ ...t, avatar: avatarUrl(t) });
}));

app.post('/api/trainers/:slug/archive', (req, res) => {
  store.trainerArchive(req.params.slug);
  res.json({ ok: true });
});

app.get('/api/pokemon', (req, res) => res.json(store.list()));
app.get('/api/pokemon/:id', (req, res) => res.json(store.get(req.params.id)));

app.post('/api/pokemon', wrap(async (req, res) => {
  const { prompt, provider = DEFAULT_PROVIDER, trainer } = req.body;
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Type an idea first!' });
  const { stage, backstory } = await text.newPokemon(prompt.trim());
  const { artPrompt, ...stageData } = stage;
  const art = await getProvider(provider).generate({
    prompt: withContinuity(provider, artPrompt, ''),
  });
  logCost(provider);
  const record = store.create({
    ...(trainer ? { createdBy: trainer } : {}),
    backstory,
    stages: [{ ...stageData, prompt: prompt.trim(), art: null }],
  });
  record.stages[0].art = store.saveArt(record.id, `stage-1.${extFor(art.mime)}`, art.data);
  store.save(record);
  res.json(record);
}));

app.post('/api/pokemon/:id/evolve', wrap(async (req, res) => {
  const { provider = DEFAULT_PROVIDER, instruction } = req.body;
  const record = store.get(req.params.id);
  // Like the real TCG: Basic -> Stage 1 -> Stage 2, then fully evolved.
  if (record.stages.length >= 3) {
    return res.status(400).json({ error: `${record.stages[2].name} is fully evolved! No Pokemon evolves more than twice.` });
  }
  const prev = record.stages[record.stages.length - 1];
  const guidance = (instruction || '').trim();
  // Steering applies at both levels: the text model shapes the evolution concept
  // (name, category, stats) and the image prompt shapes the art.
  const { artPrompt, ...stageData } = await text.evolvedStage(record, guidance || undefined);
  const p = getProvider(provider);
  const prompt = `${withContinuity(provider,
    `Evolve this creature. Its evolved form: ${artPrompt}
Same species, same color palette, same art style, clearly a bigger more powerful evolution.
The evolved form should look sturdier or sharper than before, same palette, keep one signature feature.`,
    prev.description)}${guidance ? `\nThe kid asked for: ${guidance}.` : ''}\n${NO_TEXT}`;
  const reference = p.supportsReference
    ? { data: store.readArt(record.id, prev.art), mime: mimeFor(prev.art) }
    : undefined;
  const art = await p.generate({ prompt, reference });
  logCost(provider);
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
  const record = store.get(req.params.id);
  const idx = stageIndex === undefined ? record.stages.length - 1 : stageIndex;
  const stage = record.stages[idx];
  const said = (instruction || '').trim();
  // Blank = "draw my original idea again": stage 0 uses the kid's own words, later stages the description.
  const base = said
    ? `${said}. Keep it the same creature, same cel-shaded Pokemon-style game art, full body, plain white background.`
    : `Draw this creature fresh: ${idx === 0 ? record.stages[0].prompt : stage.description}`;
  const p = getProvider(provider);
  const current = store.readArt(record.id, stage.art);
  const placeholder = current.length < 500; // mock's 1x1 png - no real art to draw from
  const reference = p.supportsReference && !placeholder
    ? { data: current, mime: mimeFor(stage.art) }
    : undefined;
  // Without a reference image, hand the artist the text description instead (as withContinuity does).
  const composed = reference || !stage.description ? base : `${base}\nThe creature looks like this: ${stage.description}`;
  const prompt = `${composed}\n${NO_TEXT}`;
  const art = await p.generate({ prompt, reference });
  logCost(provider);
  store.backupArt(record.id, stage.art);
  stage.art = store.saveArt(record.id, `stage-${idx + 1}.${extFor(art.mime)}`, art.data);
  // ponytail: naive continuity note; regenerate description via vision call if drift ever matters
  if (said) stage.description += ` Recently altered: ${said}.`;
  store.save(record);
  res.json(record);
}));

app.delete('/api/pokemon/:id', (req, res) => {
  store.archive(req.params.id);
  res.json({ ok: true });
});

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
  fs.appendFileSync(path.resolve(DATA_DIR, 'errors.log'),
    `${new Date().toISOString()} ${req.method} ${req.path} :: ${err.message}\n`);
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
