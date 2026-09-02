// Terminal view onto the live event console (issue #19): tails GET /api/console, the same
// broadcast the browser's toggleable console window reads. If the server isn't already
// running, starts it (npm start already backgrounds + logs) and waits for it to come up.
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

const COLORS = { model: '\x1b[35m', prompt: '\x1b[36m', handoff: '\x1b[37m', image: '\x1b[32m', rarity: '\x1b[33m' };
const RESET = '\x1b[0m';

async function isUp() {
  try { return (await fetch(`${BASE}/api/config`)).ok; } catch { return false; }
}

async function waitUp(tries = 30) {
  for (let i = 0; i < tries; i++) {
    if (await isUp()) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  if (!(await isUp())) {
    console.log('Pokemine is not running - starting it (npm start)...');
    execSync('npm start', { stdio: 'inherit', cwd: ROOT });
    if (!(await waitUp())) { console.error('Server did not come up in time.'); process.exit(1); }
  }
  console.log(`Tailing ${BASE}/api/console - Ctrl+C to stop (server keeps running; npm stop to stop it)\n`);

  const res = await fetch(`${BASE}/api/console`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
      let evt = 'message', data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) evt = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (evt !== 'log') continue;
      const d = JSON.parse(data);
      const time = new Date(d.ts).toLocaleTimeString();
      const color = COLORS[d.kind] || '';
      console.log(`${color}[${time}] ${d.kind.padEnd(7)} ${d.text}${RESET}`);
    }
  }
}

main();
