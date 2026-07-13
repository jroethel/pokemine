const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokemine-'));

const store = require('../lib/store');
store.init(process.env.DATA_DIR);

test('store: create/list/get/save round trip', () => {
  const rec = store.create({ backstory: 'b', stages: [{ name: 'Gyatt!', hp: 70 }] });
  assert.match(rec.id, /^gyatt-/);
  assert.equal(rec.number, 1);
  assert.equal(store.get(rec.id).stages[0].hp, 70);
  rec.stages[0].hp = 80;
  store.save(rec);
  assert.equal(store.get(rec.id).stages[0].hp, 80);
  const rec2 = store.create({ backstory: '', stages: [{ name: '???' }] });
  assert.equal(rec2.number, 2);
  assert.match(rec2.id, /^pokemon-/); // punctuation-only name falls back to 'pokemon'
  assert.equal(store.list().length, 2);
  assert.deepEqual(store.list().map(r => r.number), [1, 2]);
});

test('store: art save/read/backup', () => {
  const rec = store.create({ backstory: '', stages: [{ name: 'Arty' }] });
  store.saveArt(rec.id, 'stage-1.jpg', Buffer.from('AAA'));
  assert.equal(store.readArt(rec.id, 'stage-1.jpg').toString(), 'AAA');
  store.backupArt(rec.id, 'stage-1.jpg');
  store.saveArt(rec.id, 'stage-1.jpg', Buffer.from('BBB'));
  assert.equal(store.readArt(rec.id, 'stage-1.v1.jpg').toString(), 'AAA');
  assert.equal(store.readArt(rec.id, 'stage-1.jpg').toString(), 'BBB');
});

test('store: archive moves a pokemon out of list into a hidden archive folder', () => {
  const rec = store.create({ backstory: '', stages: [{ name: 'Goner' }] });
  assert.ok(store.list().some(p => p.id === rec.id));
  store.archive(rec.id);
  assert.ok(!store.list().some(p => p.id === rec.id));
  assert.ok(fs.existsSync(path.join(store.root(), '..', 'archive', rec.id, 'pokemon.json')));
});

const { getProvider, withContinuity, listProviders, extFor } = require('../lib/providers');

test('providers: mock generates, stubs throw, unknown throws', async () => {
  const img = await getProvider('mock').generate({ prompt: 'x' });
  assert.ok(img.data.length > 0);
  assert.equal(img.mime, 'image/png');
  await assert.rejects(getProvider('local').generate({}), /local: not implemented/);
  assert.throws(() => getProvider('nope'), /unknown provider/);
  assert.deepEqual(listProviders().map(p => p.name).sort(),
    ['bridge', 'gemini', 'local', 'mock', 'zai']);
});

test('providers: withContinuity injects description only when provider lacks reference support', () => {
  assert.equal(withContinuity('gemini', 'p', 'desc'), 'p');
  assert.match(withContinuity('zai', 'p', 'desc'), /desc/);
  assert.equal(withContinuity('zai', 'p', ''), 'p');
});

const { bridgeJobsDir } = require('../lib/providers');
const PIXEL_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('providers: bridge writes a job file and returns art a fake driver fulfills', async () => {
  process.env.BRIDGE_POLL_MS = '30';
  const dir = bridgeJobsDir();
  // fake driver: as soon as the job JSON lands, write the png
  const driver = (async () => {
    for (let i = 0; i < 100; i++) {
      const job = fs.readdirSync(dir).find(f => f.endsWith('.json'));
      if (job) { fs.writeFileSync(path.join(dir, job.replace('.json', '.png')), Buffer.from(PIXEL_B64, 'base64')); return; }
      await new Promise(r => setTimeout(r, 10));
    }
  })();
  const art = await getProvider('bridge').generate({ prompt: 'a butt pokemon' });
  await driver;
  assert.equal(art.mime, 'image/png');
  assert.ok(art.data.length > 0);
  // provider tidies the Drive-synced folder afterward
  assert.equal(fs.readdirSync(dir).filter(f => !f.startsWith('.')).length, 0);
});

test('providers: bridge surfaces a driver .error and cleans up', async () => {
  process.env.BRIDGE_POLL_MS = '30';
  const dir = bridgeJobsDir();
  const driver = (async () => {
    for (let i = 0; i < 100; i++) {
      const job = fs.readdirSync(dir).find(f => f.endsWith('.json'));
      if (job) { fs.writeFileSync(path.join(dir, job.replace('.json', '.error')), 'gemini tab not signed in'); return; }
      await new Promise(r => setTimeout(r, 10));
    }
  })();
  await assert.rejects(getProvider('bridge').generate({ prompt: 'x' }), /gemini tab not signed in/);
  await driver;
  assert.equal(fs.readdirSync(dir).filter(f => !f.startsWith('.')).length, 0);
});

test('providers: withContinuity injects description for bridge (no reference support)', () => {
  assert.match(withContinuity('bridge', 'p', 'desc'), /desc/);
});

test('providers: extFor maps mime to extension', () => {
  assert.equal(extFor('image/jpeg'), 'jpg');
  assert.equal(extFor('image/png'), 'png');
  assert.equal(extFor('image/webp'), 'webp');
});

const { callJSON, extractJSON, validateStage } = require('../lib/text');

test('text: callJSON retries once on malformed JSON, succeeds', async () => {
  const realFetch = global.fetch;
  let n = 0;
  const good = { candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }] };
  const garbage = { candidates: [{ content: { parts: [{ text: 'not json' }] } }] };
  global.fetch = async () => ({ json: async () => (n++ === 0 ? garbage : good) });
  try {
    assert.deepEqual(await callJSON('p'), { ok: 1 });
    assert.equal(n, 2);
  } finally { global.fetch = realFetch; }
});

test('text: callJSON throws when JSON is malformed twice', async () => {
  const realFetch = global.fetch;
  const garbage = { candidates: [{ content: { parts: [{ text: 'not json' }] } }] };
  global.fetch = async () => ({ json: async () => garbage });
  try {
    await assert.rejects(callJSON('p'), /JSON/);
  } finally { global.fetch = realFetch; }
});

test('text: callJSON injects CANON_FILE contents into the system prompt', async () => {
  const realFetch = global.fetch;
  const canon = path.join(process.env.DATA_DIR, 'canon.md');
  fs.writeFileSync(canon, 'SECRET_CANON_MARKER');
  process.env.CANON_FILE = canon;
  let sent;
  global.fetch = async (url, opts) => {
    sent = JSON.parse(opts.body).system_instruction.parts[0].text;
    return { json: async () => ({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }) };
  };
  try {
    await callJSON('p');
    assert.match(sent, /## Universe canon/);
    assert.match(sent, /SECRET_CANON_MARKER/);
  } finally {
    global.fetch = realFetch;
    delete process.env.CANON_FILE;
  }
});

test('text: extractJSON parses gemini response text parts', () => {
  const api = { candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }] };
  assert.deepEqual(extractJSON(api), { a: 1 });
});

test('text: validateStage rejects incomplete stages', () => {
  assert.throws(() => validateStage({ name: 'x' }), /missing field: category/);
  const ok = { name: 'x', category: 'c', types: ['Fire'], hp: 50, flavor: 'f',
    moves: [], artPrompt: 'a', description: 'd' };
  assert.equal(validateStage(ok), ok);
});

test('text: validateStage rejects bare-string moves, newPokemon retries once on bad shape', async () => {
  const base = { name: 'x', category: 'c', types: ['Fire'], hp: 50, flavor: 'f',
    artPrompt: 'a', description: 'd' };
  assert.throws(() => validateStage({ ...base, moves: ['Salsa Squirt', 'Shell Slam'] }),
    /missing field: moves shape/);
  assert.throws(() => validateStage({ ...base, moves: [{ name: 'm', damage: 10 }] }),
    /missing field: moves shape/);

  // bad shape on first generation, good on second -> newPokemon succeeds
  const { newPokemon } = require('../lib/text');
  const realFetch = global.fetch;
  let calls = 0;
  const respond = payload => ({ json: async () => ({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }) });
  global.fetch = async () => {
    calls++;
    const moves = calls === 1 ? ['bare string'] : [{ name: 'm', damage: 10, text: 't' }];
    return respond({ stage: { ...base, moves }, backstory: 'b' });
  };
  try {
    const data = await newPokemon('test');
    assert.equal(calls, 2);
    assert.equal(data.stage.moves[0].name, 'm');
  } finally {
    global.fetch = realFetch;
  }
});

test('api: create, evolve, alter, patch lifecycle', async () => {
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes('generativelanguage')) {
      const stage = { name: 'Gyatt', category: 'The Butt Pokemon', types: ['Fairy'], hp: 70,
        flavor: 'f', moves: [{ name: 'Toot', damage: 30, text: 't' }], artPrompt: 'a', description: 'd' };
      const isNew = JSON.parse(opts.body).contents[0].parts[0].text.includes('A kid wants a new Pokemon');
      const payload = isNew
        ? { stage, backstory: 'born in a gym sock' }
        : { ...stage, name: 'Gyattzilla', hp: 120 };
      return { json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }) };
    }
    return realFetch(url, opts);
  };

  const app = require('../server');
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = (path, method = 'GET', body) => fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => ({ status: r.status, body: await r.json() }));

  // spy on the prompt the mock artist receives so we can assert the no-text rule is present
  const mock = getProvider('mock');
  const realGen = mock.generate;
  let lastPrompt = '';
  mock.generate = async a => { lastPrompt = a.prompt; return realGen(a); };

  try {
    let r = await call('/api/pokemon', 'POST', { prompt: '', provider: 'mock' });
    assert.equal(r.status, 400);

    r = await call('/api/pokemon', 'POST', { prompt: 'a butt pokemon', provider: 'mock' });
    assert.equal(r.status, 200);
    const rec = r.body;
    assert.equal(rec.stages[0].name, 'Gyatt');
    assert.equal(rec.stages[0].art, 'stage-1.png');
    assert.equal(rec.backstory, 'born in a gym sock');
    assert.ok(store.readArt(rec.id, 'stage-1.png').length > 0);

    r = await call(`/api/pokemon/${rec.id}/evolve`, 'POST', { instruction: 'make it a dragon', provider: 'mock' });
    assert.match(lastPrompt, /Do not write/); // no-text rule on the evolve prompt
    assert.match(lastPrompt, /make it a dragon/); // evolve steering reaches the image prompt
    assert.equal(r.body.stages.length, 2);
    assert.equal(r.body.stages[1].name, 'Gyattzilla');
    assert.equal(r.body.stages[1].art, 'stage-2.png');

    r = await call(`/api/pokemon/${rec.id}/alter`, 'POST', { instruction: 'angrier', stage: 0, provider: 'mock' });
    assert.ok(store.readArt(rec.id, 'stage-1.v1.png').length > 0);
    assert.match(r.body.stages[0].description, /angrier/);
    assert.match(lastPrompt, /Do not write/); // no-text rule on the alter prompt

    // blank Redraw = "draw my original idea again": no 400, art re-saved, backup kept
    fs.rmSync(path.join(process.env.DATA_DIR, 'pokemon', rec.id, 'stage-1.v1.png'));
    r = await call(`/api/pokemon/${rec.id}/alter`, 'POST', { stage: 0, provider: 'mock' });
    assert.equal(r.status, 200);
    assert.equal(r.body.stages[0].art, 'stage-1.png');
    assert.ok(store.readArt(rec.id, 'stage-1.v1.png').length > 0);

    r = await call(`/api/pokemon/${rec.id}`, 'PATCH', { stage: 0, name: 'Sir Gyatt', hp: 90 });
    assert.equal(r.body.stages[0].name, 'Sir Gyatt');
    assert.equal(store.get(rec.id).stages[0].hp, 90);

    r = await call('/api/pokemon');
    assert.ok(r.body.some(p => p.id === rec.id));

    r = await call(`/api/pokemon/${rec.id}`, 'DELETE');
    assert.deepEqual(r.body, { ok: true });
    r = await call('/api/pokemon');
    assert.ok(!r.body.some(p => p.id === rec.id)); // released -> gone from the dex
  } finally {
    srv.close();
    global.fetch = realFetch;
    mock.generate = realGen;
  }
});

test('api: cost ledger tracks session and persists all-time', async () => {
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes('generativelanguage')) {
      const payload = { stage: { name: 'Penny', category: 'The Coin Pokemon', types: ['Steel'], hp: 40,
        flavor: 'f', moves: [{ name: 'Spend', damage: 10, text: 't' }], artPrompt: 'a', description: 'd' },
        backstory: 'minted' };
      return { json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }) };
    }
    return realFetch(url, opts);
  };
  const app = require('../server');
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = (p, method = 'GET', body) => fetch(`${base}${p}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => ({ status: r.status, body: await r.json() }));

  try {
    // delta-based: the server process is shared across tests, so measure the change
    const before = (await call('/api/config')).body.cost;
    await call('/api/pokemon', 'POST', { prompt: 'a coin pokemon', provider: 'mock' });
    await call('/api/pokemon', 'POST', { prompt: 'another coin', provider: 'mock' });
    const after = (await call('/api/config')).body.cost;
    assert.equal(after.session.images - before.session.images, 2);
    assert.equal(after.session.cost - before.session.cost, 0); // mock is free
    const ledger = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'costs.json'), 'utf8'));
    assert.ok(ledger.images >= 2);
    assert.equal(ledger.images, after.total.images);
  } finally {
    srv.close();
    global.fetch = realFetch;
  }
});

test('api: bridge create fulfilled by an HTTP-driver loop', async () => {
  process.env.BRIDGE_POLL_MS = '40';
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes('generativelanguage')) {
      const payload = { stage: { name: 'Bridgey', category: 'The Proxy Pokemon', types: ['Steel'], hp: 60,
        flavor: 'f', moves: [{ name: 'Relay', damage: 20, text: 't' }], artPrompt: 'a', description: 'd' },
        backstory: 'routed through a browser tab' };
      return { json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }) };
    }
    return realFetch(url, opts);
  };

  const app = require('../server');
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = (p, method = 'GET', body) => fetch(`${base}${p}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => ({ status: r.status, body: await r.json() }));

  try {
    // driver: poll for the job, answer with a 1x1 png (mirrors the Brave extension loop)
    const driver = (async () => {
      for (let i = 0; i < 200; i++) {
        const { body: jobs } = await call('/api/bridge/jobs');
        if (jobs.length) {
          await call(`/api/bridge/jobs/${jobs[0].id}/result`, 'POST', { b64: PIXEL_B64, mime: 'image/png' });
          return jobs[0];
        }
        await new Promise(r => setTimeout(r, 20));
      }
    })();

    const created = await call('/api/pokemon', 'POST', { prompt: 'a proxy pokemon', provider: 'bridge' });
    const job = await driver;
    assert.ok(job, 'driver saw a job');
    assert.equal(created.status, 200);
    assert.equal(created.body.stages[0].art, 'stage-1.png');
    assert.ok(store.readArt(created.body.id, 'stage-1.png').length > 0);
  } finally {
    srv.close();
    global.fetch = realFetch;
  }
});
