const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokemine-bridge-'));

test('writeBridgeJob embeds a server-driven timeoutMs', () => {
  process.env.BRIDGE_TIMEOUT_MS = '300000';
  const { writeBridgeJob, bridgeJobsDir } = require('../lib/providers');
  const id = writeBridgeJob(bridgeJobsDir(), 'a creature');
  const job = JSON.parse(fs.readFileSync(path.join(bridgeJobsDir(), `${id}.json`), 'utf8'));
  assert.equal(job.timeoutMs, 295000); // 300000 - 5000 buffer
  assert.match(job.prompt, /a creature/);
});

test('PIXEL is a real PNG buffer (placeholder for art-failed)', () => {
  const { PIXEL } = require('../lib/providers');
  assert.ok(Buffer.isBuffer(PIXEL) && PIXEL.length > 0);
});
