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
