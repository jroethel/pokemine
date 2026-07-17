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

test('post-header throw (store failure) -> SSE error event, not a truncated stream', async () => {
  const store = require('../lib/store');
  const original = store.saveArt;
  store.saveArt = () => { throw new Error('disk full'); };
  try {
    const { text: body } = await createBody({ prompt: 'a blob', provider: 'mock' });
    const events = parseEvents(body);
    assert.ok(events.some(e => e.event === 'error' && /disk full/.test(e.data.message)));
    assert.ok(!events.some(e => e.event === 'done'));
  } finally { store.saveArt = original; }
});

test('bridge offline -> 400 bridge-offline, no stream', async () => {
  const { status, text } = await createBody({ prompt: 'x', provider: 'bridge' });
  assert.equal(status, 400);
  assert.match(JSON.parse(text).error, /bridge-offline/);
});
