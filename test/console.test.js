const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokemine-console-'));
process.env.DEFAULT_IMAGE_PROVIDER = 'mock';

const eventlog = require('../lib/eventlog');

test('eventlog: emit notifies live subscribers and records history', () => {
  const seen = [];
  const unsubscribe = eventlog.subscribe(e => seen.push(e));
  eventlog.emit('model', 'hello');
  unsubscribe();
  eventlog.emit('model', 'not seen - unsubscribed');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'model');
  assert.equal(seen[0].text, 'hello');
  assert.ok(typeof seen[0].ts === 'number');
  assert.ok(eventlog.history().some(e => e.text === 'hello'));
});

test('eventlog: history caps so a long session does not grow unbounded', () => {
  for (let i = 0; i < 300; i++) eventlog.emit('handoff', `n${i}`);
  const hist = eventlog.history();
  assert.ok(hist.length <= 50);
  assert.equal(hist[hist.length - 1].text, 'n299'); // newest survives the cap
});

// Read a GET SSE stream for a short bounded window, then stop - used to capture the
// synchronous history replay from /api/console without waiting for it to end (it never does).
async function readBriefly(url, ms = 500) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  let buf = '';
  try {
    const res = await fetch(url, { signal: ac.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
    }
  } catch { /* abort is the expected way this loop ends */ }
  clearTimeout(timer);
  return buf.split('\n\n').filter(Boolean).map(block => {
    const ev = {};
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) ev.event = line.slice(7);
      if (line.startsWith('data: ')) ev.data = JSON.parse(line.slice(6));
    }
    return ev;
  });
}

test('GET /api/console replays a create/evolve run\'s log events, color-kind sequence intact', async () => {
  const text = require('../lib/text');
  const realNewPokemon = text.newPokemon;
  const realEvolvedStage = text.evolvedStage;
  text.newPokemon = async () => ({
    name: 'Consolemon', category: 'The Testing Pokemon', types: ['normal'], hp: 70, flavor: 'f',
    moves: [{ name: 'Tackle', damage: 30, text: 'bop' }], artPrompt: 'a blob', description: 'd', backstory: 'b',
  });
  text.evolvedStage = async () => ({
    name: 'Consolemon II', category: 'The Testing Pokemon', types: ['normal'], hp: 90, flavor: 'f',
    moves: [{ name: 'Tackle', damage: 40, text: 'bop' }], artPrompt: 'a bigger blob', description: 'd2', backstory: 'b2',
  });

  const parseRaw = raw => raw.split('\n\n').filter(Boolean).map(block => {
    const ev = {};
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) ev.event = line.slice(7);
      if (line.startsWith('data: ')) ev.data = JSON.parse(line.slice(6));
    }
    return ev;
  });

  const app = require('../server');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const createText = await fetch(`${base}/api/pokemon`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'console check', provider: 'mock' }),
    }).then(r => r.text());
    const created = parseRaw(createText).find(e => e.event === 'done').data.record;

    let events = await readBriefly(`${base}/api/console`);
    let kinds = events.filter(e => e.event === 'log').map(e => e.data.kind);
    assert.deepEqual(kinds.slice(-8), ['model', 'prompt', 'handoff', 'model', 'prompt', 'image', 'image', 'handoff']);

    await fetch(`${base}/api/pokemon/${created.id}/evolve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'mock' }),
    }).then(r => r.text());

    events = await readBriefly(`${base}/api/console`);
    kinds = events.filter(e => e.event === 'log').map(e => e.data.kind);
    assert.deepEqual(kinds.slice(-7), ['rarity', 'model', 'handoff', 'model', 'prompt', 'image', 'image']);
    assert.match(events.filter(e => e.event === 'log').slice(-7)[0].data.text, /no special/i);
  } finally {
    server.close();
    text.newPokemon = realNewPokemon;
    text.evolvedStage = realEvolvedStage;
  }
});
