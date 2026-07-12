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
