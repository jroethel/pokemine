// Live proof: start the real server, POST a create with provider `bridge`, and run a
// tiny mock driver that polls GET /api/bridge/jobs and answers with a 1x1 png.
// Gemini *text* is stubbed so this runs offline and calls no paid/image API.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-e2e-'));
process.env.BRIDGE_POLL_MS = '200';

const PIXEL_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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
const call = (p, method = 'GET', body) => realFetch(`${base}${p}`, {
  method, headers: { 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
}).then(async r => ({ status: r.status, body: await r.json() }));

(async () => {
  const driver = (async () => {
    for (let i = 0; i < 200; i++) {
      const { body: jobs } = await call('/api/bridge/jobs');
      if (jobs.length) {
        console.log('[driver] saw job', jobs[0].id, '-', jobs[0].prompt);
        await call(`/api/bridge/jobs/${jobs[0].id}/result`, 'POST', { b64: PIXEL_B64, mime: 'image/png' });
        console.log('[driver] posted result');
        return jobs[0];
      }
      await new Promise(r => setTimeout(r, 100));
    }
  })();

  console.log('[app] POST /api/pokemon provider=bridge');
  const created = await call('/api/pokemon', 'POST', { prompt: 'a proxy pokemon', provider: 'bridge' });
  const job = await driver;

  const ok = created.status === 200 && created.body.stages?.[0]?.art === 'stage-1.png' && !!job;
  console.log('[app] created:', created.status, created.body.id, created.body.stages?.[0]?.art);
  console.log(ok ? '\nPASS: bridge create fulfilled by the mock driver loop' : '\nFAIL');
  srv.close();
  process.exit(ok ? 0 : 1);
})();
