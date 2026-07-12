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

const { getProvider, withContinuity, listProviders, extFor } = require('../lib/providers');

test('providers: mock generates, stubs throw, unknown throws', async () => {
  const img = await getProvider('mock').generate({ prompt: 'x' });
  assert.ok(img.data.length > 0);
  assert.equal(img.mime, 'image/png');
  await assert.rejects(getProvider('bridge').generate({}), /bridge: not implemented/);
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

test('providers: extFor maps mime to extension', () => {
  assert.equal(extFor('image/jpeg'), 'jpg');
  assert.equal(extFor('image/png'), 'png');
  assert.equal(extFor('image/webp'), 'webp');
});

const { extractJSON, validateStage } = require('../lib/text');

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

    r = await call(`/api/pokemon/${rec.id}/evolve`, 'POST', { provider: 'mock' });
    assert.equal(r.body.stages.length, 2);
    assert.equal(r.body.stages[1].name, 'Gyattzilla');
    assert.equal(r.body.stages[1].art, 'stage-2.png');

    r = await call(`/api/pokemon/${rec.id}/alter`, 'POST', { instruction: 'angrier', stage: 0, provider: 'mock' });
    assert.ok(store.readArt(rec.id, 'stage-1.v1.png').length > 0);
    assert.match(r.body.stages[0].description, /angrier/);

    r = await call(`/api/pokemon/${rec.id}`, 'PATCH', { stage: 0, name: 'Sir Gyatt', hp: 90 });
    assert.equal(r.body.stages[0].name, 'Sir Gyatt');
    assert.equal(store.get(rec.id).stages[0].hp, 90);

    r = await call('/api/pokemon');
    assert.ok(r.body.some(p => p.id === rec.id));
  } finally {
    srv.close();
    global.fetch = realFetch;
  }
});
