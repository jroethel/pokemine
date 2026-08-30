const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokemine-cors-'));

const app = require('../server');

async function bridgeGet(headers) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/api/bridge/jobs`, { headers });
    return res;
  } finally { server.close(); }
}

test('a foreign origin gets no CORS/PNA headers (issue #12: no cross-origin read/forge)', async () => {
  const res = await bridgeGet({ Origin: 'https://evil.example' });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.equal(res.headers.get('access-control-allow-private-network'), null);
});

test('the gemini driver origin is reflected, not wildcarded', async () => {
  const res = await bridgeGet({ Origin: 'https://gemini.google.com' });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://gemini.google.com');
  assert.equal(res.headers.get('access-control-allow-private-network'), 'true');
});

test('the extension path (no Origin header) still reaches the jobs list', async () => {
  const res = await bridgeGet({});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});
