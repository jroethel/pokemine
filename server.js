const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./lib/store');
const text = require('./lib/text');
const { listTextProviders } = require('./lib/text-providers');
const { getProvider, withContinuity, listProviders, extFor, bridgeJobsDir, PIXEL } = require('./lib/providers');
const { autocrop } = require('./lib/autocrop');
const eventlog = require('./lib/eventlog');

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

// CORS + Private Network Access on the bridge endpoints, so a page-context driver
// (a script running on gemini.google.com) can fulfill jobs against this LAN server.
// Restricted to that one driver origin: a wildcard let any page a family member
// visits read the child's typed prompts (GET jobs) or forge an image result
// cross-origin (issue #12). The extension's service-worker fetches bypass CORS via
// host_permissions, so they need no header and are unaffected by this restriction.
const BRIDGE_ORIGINS = new Set(['https://gemini.google.com']);
app.use('/api/bridge', (req, res, next) => {
  const origin = req.get('Origin');
  if (origin && BRIDGE_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Allow-Private-Network', 'true');
  }
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
const SAFE_BRIDGE_ID = /^[a-z0-9-]+$/;

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
      const { prompt, timeoutMs } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      jobs.push({ id, prompt, timeoutMs });
      bridge.claims.set(id, now);
    } catch { /* half-written job file, pick it up next poll */ }
  }
  res.json(jobs);
});

app.post('/api/bridge/jobs/:id/result', (req, res) => {
  if (!SAFE_BRIDGE_ID.test(req.params.id)) return res.status(400).json({ error: 'bad job id' });
  const { b64, mime } = req.body;
  const ext = mime === 'image/jpeg' || mime === 'image/jpg' ? 'jpg' : 'png';
  fs.writeFileSync(path.join(bridgeJobsDir(), `${req.params.id}.${ext}`), Buffer.from(b64, 'base64'));
  bridge.claims.delete(req.params.id);
  res.json({ ok: true });
});

app.post('/api/bridge/jobs/:id/error', (req, res) => {
  if (!SAFE_BRIDGE_ID.test(req.params.id)) return res.status(400).json({ error: 'bad job id' });
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
    textProvider: process.env.TEXT_PROVIDER || 'gemini',
    textProviders: listTextProviders(),
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
    }).then(autocrop),
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
  if (!t) return res.status(404).json({ error: 'Not found' });
  // Backfill once and persist: covers trainers made before profiles existed AND
  // profiles from before favorite Pokemon / finishing move were added.
  if (!t.backstory || !t.finishingMove) {
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
app.get('/api/pokemon/:id', (req, res) => {
  const rec = store.get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  res.json(rec);
});

const SSE = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const PHASES = {
  text:  { name: 'text',  msg: 'Sending your idea to the Professor...' },
  image: { name: 'image', msg: 'Drawing your Pokemon...' },
};

// Live event console (issue #19): broadcast globally (lib/eventlog), not tied to any one
// request - a browser tab or a terminal tailer can watch generation happen from outside
// the request that triggered it. kind drives the row color: prompt/model/handoff/rarity/image.
const trim = (s, n = 140) => (s.length > n ? `${s.slice(0, n)}…` : s);
const LOG = (kind, text) => eventlog.emit(kind, text);

// GET /api/console: SSE tail of the live event log. Replays recent history on connect,
// then streams new events as they happen. No 'done' - the client (or curl) keeps this open.
app.get('/api/console', (req, res) => {
  res.set('Content-Type', 'text/event-stream');
  res.set('Cache-Control', 'no-cache');
  res.set('Connection', 'keep-alive');
  for (const entry of eventlog.history()) SSE(res, 'log', entry);
  const unsubscribe = eventlog.subscribe(entry => SSE(res, 'log', entry));
  req.on('close', unsubscribe);
});

function logGeneration({ id = '-', provider, t0, textMs, imageMs, outcome }) {
  const line = `${new Date().toISOString()} id=${id} provider=${provider} textMs=${textMs ?? '-'} imageMs=${imageMs ?? '-'} totalMs=${Date.now() - t0} outcome=${outcome}\n`;
  fs.appendFileSync(path.resolve(DATA_DIR, 'generation.log'), line);
}

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

  // Kid closed the tab mid-generation: stop before the next expensive step instead
  // of running to completion and writing to a dead socket.
  // ponytail: flag only; the in-flight fetch (incl. the 300s bridge poll) isn't
  // cancelled - thread an AbortSignal into providers if that wait must end early.
  let aborted = false;
  res.on('close', () => { if (!res.writableEnded) aborted = true; });

  const t0 = Date.now();
  let stage, textMs;
  try {
    SSE(res, 'phase', PHASES.text);
    LOG('model', `Text model: ${textProvider || process.env.TEXT_PROVIDER || 'gemini'}`);
    LOG('prompt', `Kid's idea: "${trim(prompt.trim())}"`);
    const tText = Date.now();
    stage = await text.newPokemon(prompt.trim(), { textProvider });
    textMs = Date.now() - tText;
    LOG('handoff', `${stage.name} concept ready (${stage.types.join('/')}, ${stage.hp} HP) → sending to the artist`);
  } catch (e) {
    SSE(res, 'error', { message: e.message });
    logGeneration({ provider, t0, textMs, outcome: 'error' });
    return res.end();
  }
  if (aborted) { logGeneration({ provider, t0, textMs, outcome: 'aborted' }); return res.end(); }

  const { artPrompt, ...stageData } = stage;
  let art, outcome = 'ok', warning, imageMs;
  const tImg = Date.now();
  try {
    SSE(res, 'phase', PHASES.image);
    LOG('model', `Image model: ${provider}`);
    const imgPrompt = `${withContinuity(provider, artPrompt, '')}\nThe kid asked for: ${prompt.trim()}.`;
    LOG('prompt', `Art prompt: ${trim(imgPrompt)}`);
    LOG('image', 'Drawing...');
    art = await autocrop(await getProvider(provider).generate({ prompt: imgPrompt }));
    logCost(provider);
    LOG('image', 'Art ready');
  } catch (e) {
    art = { data: PIXEL, mime: 'image/png' }; // placeholder; Redraw retries the picture
    outcome = 'art-failed'; warning = 'art-failed';
    LOG('image', 'Art generation failed - using a placeholder (Redraw to retry)');
  }
  imageMs = Date.now() - tImg;
  if (aborted) { logGeneration({ provider, t0, textMs, imageMs, outcome: 'aborted' }); return res.end(); }

  LOG('handoff', 'Saving card...');
  const record = store.create({
    ...(trainer ? { createdBy: trainer } : {}),
    stages: [{ ...stageData, prompt: prompt.trim(), art: null }],
  });
  try {
    record.stages[0].art = store.saveArt(record.id, `stage-1.${extFor(art.mime)}`, art.data);
    store.save(record);
  } catch (e) {
    store.remove(record.id); // art write failed: delete the orphan card rather than leave one with no image
    throw e;
  }
  logGeneration({ id: record.id, provider, t0, textMs, imageMs, outcome });
  SSE(res, 'done', { record, seconds: (Date.now() - t0) / 1000, ...(warning ? { warning } : {}) });
  res.end();
}));

app.post('/api/pokemon/:id/evolve', wrap(async (req, res) => {
  const { provider = DEFAULT_PROVIDER, instruction } = req.body;
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Not found' });
  // Like the real TCG: Basic -> Stage 1 -> Stage 2, then fully evolved.
  if (record.stages.length >= 3) {
    return res.status(400).json({ error: `${record.stages[2].name} is fully evolved! No Pokemon evolves more than twice.` });
  }

  res.set('Content-Type', 'text/event-stream');
  res.set('Cache-Control', 'no-cache');
  res.set('Connection', 'keep-alive');

  try {
    const prev = record.stages[record.stages.length - 1];
    const guidance = (instruction || '').trim();
    const stageNo = record.stages.length + 1;
    const variant = text.rollSpecial(stageNo); // 30% jackpot, only rolling into stage 3
    LOG('rarity', variant ? `✨ Rolled a rare ${variant} evolution!` : 'No special variant this roll');
    // Steering applies at both levels: the text model shapes the evolution concept
    // (name, category, stats) and the image prompt shapes the art.
    SSE(res, 'phase', PHASES.text);
    LOG('model', `Text model: ${process.env.TEXT_PROVIDER || 'gemini'}`);
    if (guidance) LOG('prompt', `Kid's guidance: "${trim(guidance)}"`);
    const { artPrompt, ...stageData } = await text.evolvedStage(record, guidance || undefined, variant);
    LOG('handoff', `${stageData.name} concept ready (${stageData.hp} HP) → sending to the artist`);
    const p = getProvider(provider);
    SSE(res, 'phase', PHASES.image);
    LOG('model', `Image model: ${provider}`);
    const prompt = `${withContinuity(provider,
      `Evolve this creature. Its evolved form: ${artPrompt}
Same species, same color palette, same art style, clearly a bigger more powerful evolution.
The evolved form should look sturdier or sharper than before, same palette, keep one signature feature.`,
      prev.description)}${guidance ? `\nThe kid asked for: ${guidance}.` : ''}${variant ? `\n${text.STAGES.special.variants[variant].art}.` : ''}\n${NO_TEXT}`;
    LOG('prompt', `Art prompt: ${trim(prompt)}`);
    const reference = p.supportsReference
      ? { data: store.readArt(record.id, prev.art), mime: mimeFor(prev.art) }
      : undefined;
    LOG('image', 'Drawing...');
    const art = await autocrop(await p.generate({ prompt, reference }));
    logCost(provider);
    LOG('image', 'Art ready');
    // Re-read after the multi-second image await: a concurrent evolve/alter may
    // have saved a new stage while we awaited. Mutating the pre-await copy would
    // silently discard their write. The re-read, re-check, push and save below run
    // with no await between them, so they are atomic against another request.
    const fresh = store.get(record.id);
    if (!fresh) { SSE(res, 'error', { message: 'This Pokemon is gone.' }); return; }
    if (fresh.stages.length >= 3) {
      SSE(res, 'error', { message: `${fresh.stages[2].name} is fully evolved! No Pokemon evolves more than twice.` });
      return;
    }
    const freshStageNo = fresh.stages.length + 1;
    fresh.stages.push({
      ...stageData, prompt: guidance, number: store.allocCollector(),
      ...(variant ? { variant } : {}),
      art: store.saveArt(fresh.id, `stage-${freshStageNo}.${extFor(art.mime)}`, art.data),
    });
    store.save(fresh);
    SSE(res, 'done', { record: fresh });
  } catch (e) {
    SSE(res, 'error', { message: e.message });
  } finally {
    res.end();
  }
}));

app.post('/api/pokemon/:id/alter', wrap(async (req, res) => {
  const { instruction, stage: stageIndex, provider = DEFAULT_PROVIDER, startFresh } = req.body;
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Not found' });
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
  // Start Fresh drops the reference image so a redraw can override baked-in art (issue #17)
  // that the reference would otherwise dominate over the text instruction.
  const reference = p.supportsReference && !placeholder && !startFresh
    ? { data: current, mime: mimeFor(stage.art) }
    : undefined;
  // Without a reference image, hand the artist the text description instead (as withContinuity does).
  // A blank redraw of an evolved stage already embeds it in base, so don't repeat it.
  const descInBase = !said && idx !== 0;
  const composed = reference || !stage.description || descInBase ? base : `${base}\nThe creature looks like this: ${stage.description}`;
  // A special stage keeps its look on Redraw: re-append the variant art phrase.
  const prompt = `${composed}${stage.variant ? `\n${text.STAGES.special.variants[stage.variant].art}.` : ''}\n${NO_TEXT}`;
  const art = await autocrop(await p.generate({ prompt, reference }));
  logCost(provider);
  // Re-read after the await so a concurrent evolve/alter isn't clobbered (lost update).
  const fresh = store.get(record.id);
  if (!fresh) return res.status(404).json({ error: 'Not found' });
  const freshStage = fresh.stages[idx];
  if (!freshStage) return res.status(404).json({ error: 'Not found' });
  store.backupArt(fresh.id, freshStage.art);
  freshStage.art = store.saveArt(fresh.id, `stage-${idx + 1}.${extFor(art.mime)}`, art.data);
  // ponytail: naive continuity note; regenerate description via vision call if drift ever matters
  if (said) freshStage.description += ` Recently altered: ${said}.`;
  store.save(fresh);
  res.json(fresh);
}));

app.delete('/api/pokemon/:id', (req, res) => {
  store.archive(req.params.id);
  res.json({ ok: true });
});

// Undo the most recent evolution instead of releasing the whole line. Only the last
// stage may go: dropping a middle stage would orphan later stages' art/text continuity.
app.delete('/api/pokemon/:id/stage/:idx', (req, res) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Not found' });
  if (record.stages.length <= 1) return res.status(400).json({ error: 'Release it into the wild to delete the only stage.' });
  if (+req.params.idx !== record.stages.length - 1) return res.status(400).json({ error: 'Only the most recent stage can be deleted.' });
  res.json(store.deleteLastStage(req.params.id));
});

app.patch('/api/pokemon/:id', wrap(async (req, res) => {
  const { stage: stageIndex = 0, backstory, ...fields } = req.body;
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Not found' });
  const stage = record.stages[stageIndex];
  for (const k of ['name', 'hp', 'flavor', 'moves', 'category']) {
    if (fields[k] !== undefined) stage[k] = fields[k];
  }
  if (backstory !== undefined) stage.backstory = backstory; // per-stage; legacy top-level fallback stays on read
  if (stageIndex === 0 && fields.name !== undefined) {
    record.id = store.renameFor(record.id, fields.name); // dir follows the stage-0 name
  }
  store.save(record);
  res.json(record);
}));

app.use((err, req, res, next) => {
  console.error(err);
  fs.appendFileSync(path.resolve(DATA_DIR, 'errors.log'),
    `${new Date().toISOString()} ${req.method} ${req.path} :: ${err.message}\n`);
  if (res.headersSent) { // mid-SSE stream: a 500 would throw here and truncate the stream
    SSE(res, 'error', { message: err.message });
    return res.end();
  }
  // Forward the real message: the client's friendlyError maps it to a kid-friendly
  // line (e.g. "high demand" -> "The lab is busy"), with its own generic fallback.
  res.status(500).json({ error: err.message });
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
