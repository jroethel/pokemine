const test = require('node:test');
const assert = require('node:assert');
const { esc, friendlyDate, providerLabel, VARIANT_LABELS, stageLabel } = require('../public/card-format');

test('esc escapes HTML metacharacters and coerces null/undefined', () => {
  assert.equal(esc('<b>"x" & y</b>'), '&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('providerLabel applies the zai override', () => {
  assert.equal(providerLabel({ name: 'zai' }), 'zai (off)');
});

test('providerLabel passes real providers through and flags not-yet-real ones', () => {
  assert.equal(providerLabel({ name: 'gemini', real: true }), 'gemini');
  assert.equal(providerLabel({ name: 'openai', real: false }), 'openai (soon)');
});

test('VARIANT_LABELS covers the three variant tiers', () => {
  assert.deepEqual(Object.keys(VARIANT_LABELS).sort(), ['EX', 'Mega', 'VMAX']);
});

test('friendlyDate formats an ISO string and returns "" for garbage', () => {
  assert.ok(typeof friendlyDate('2026-07-25T00:00:00.000Z') === 'string');
  assert.equal(friendlyDate('not-a-date'), '');
});

test('stageLabel: Basic for stage 0, "Stage N · Evolves from <prev>" otherwise', () => {
  // stage N's eyebrow names the PREVIOUS stage (stages[idx-1]); put the special char there.
  const rec = { stages: [{ name: 'Ivy<saur' }, { name: 'Venu' }] };
  assert.equal(stageLabel(rec, 0), 'Basic Pokémon');
  assert.equal(stageLabel(rec, 1), 'Stage 1 · Evolves from Ivy&lt;saur');
});
