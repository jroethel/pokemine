// Pokemine Bridge driver. Runs on gemini.google.com, polls the local server for
// image jobs, drives the Gemini web app to generate, and posts the result back.
// Every step mirrors the DOM contract verified live against the real signed-in app.

const log = (...a) => console.log('[pokemine-bridge]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Talk to http://localhost:3000 through the background service worker (CORS-safe).
function proxy(path, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'fetch', path, method, body }, res => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res || !res.ok) return reject(new Error(res && res.error ? res.error : `HTTP ${res && res.status}`));
      resolve(res.data);
    });
  });
}

async function waitFor(fn, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const v = fn(); if (v) return v; await sleep(200); }
  throw new Error('timed out waiting for a page element');
}

// A generated image is a same-origin img with real pixels (naturalWidth > 200).
const bigImages = () => [...document.querySelectorAll('img')].filter(im => im.complete && im.naturalWidth > 200);

async function startNewChat() {
  const link = [...document.querySelectorAll('a')]
    .find(a => (a.getAttribute('aria-label') || a.textContent || '').trim() === 'New chat');
  if (link) { link.click(); await sleep(1500); }
}

async function enterPrompt(prompt) {
  const editor = await waitFor(() => document.querySelector('div.ql-editor[contenteditable="true"]'), 10000);
  editor.focus();
  document.execCommand('insertText', false, prompt); // the entry method that works in this editor
  await sleep(300);
}

async function clickSend() {
  const btn = await waitFor(() => document.querySelector('button[aria-label="Send message"]'), 10000);
  btn.click();
}

async function waitForNewImage(baseline, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 280000);
  while (Date.now() < deadline) {
    await sleep(1500);
    const imgs = bigImages();
    if (imgs.length > baseline) return imgs[imgs.length - 1]; // newest is the result
  }
  throw new Error('no image appeared within the deadline');
}

// Gemini serves generated images cross-origin (a Google CDN), so drawing the
// <img> onto a canvas taints it and toDataURL throws. fetch() negotiates CORS
// and reaches the bytes directly; canvas is the last-resort fallback for any
// image fetch can't reach (same-origin or already-CORS-approved <img>).
async function extractImage(img) {
  try {
    const blob = await (await fetch(img.src, { credentials: 'include' })).blob();
    if (blob.size > 100 && blob.type.startsWith('image/')) {
      const b64 = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onloadend = () => res(String(fr.result).split(',')[1]);
        fr.onerror = () => rej(fr.error || new Error('FileReader failed'));
        fr.readAsDataURL(blob);
      });
      return { b64, mime: blob.type };
    }
    log('fetch returned a non-image blob -', blob.type, blob.size);
  } catch (e) { log('fetch extraction failed, trying canvas -', e.message); }
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return { b64: canvas.toDataURL('image/png').split(',')[1], mime: 'image/png' };
}

async function runJob(job) {
  log('running job', job.id, '-', job.prompt);
  try {
    await startNewChat();
    await enterPrompt(job.prompt);
    const baseline = bigImages().length;
    await clickSend();
    log('submitted, waiting for the image (~18s typical)...');
    const img = await waitForNewImage(baseline, job.timeoutMs);
    const { b64, mime } = await extractImage(img);
    await proxy(`/api/bridge/jobs/${job.id}/result`, 'POST', { b64, mime });
    log('posted result for', job.id);
  } catch (e) {
    log('job failed', job.id, '-', e.message);
    await proxy(`/api/bridge/jobs/${job.id}/error`, 'POST', { message: e.message }).catch(() => {});
  }
}

let busy = false; // one job at a time
async function tick() {
  try {
    await proxy('/api/bridge/ping', 'POST', {});
    if (busy) return;
    const jobs = await proxy('/api/bridge/jobs');
    if (jobs && jobs.length) {
      busy = true;
      try { await runJob(jobs[0]); } finally { busy = false; }
    }
  } catch (e) {
    log('tick error -', e.message);
    busy = false;
  }
}

// Tag the driver window so it's findable in the dock / cmd-Tab / Brave Window
// menu (otherwise it shows as "Gemini", same as any gemini tab). Interval rather
// than a MutationObserver because Gemini's SPA sometimes replaces the <title>
// element entirely, which would orphan an observer on the old node.
function keepTitle() {
  document.title = 'Pokemine Bridge';
  setInterval(() => { if (document.title !== 'Pokemine Bridge') document.title = 'Pokemine Bridge'; }, 1000);
}

log('driver loaded on', location.href);
// Only the dedicated managed window drives jobs (see background.js). A normal
// gemini tab could otherwise claim a job and then stall under background throttling.
chrome.runtime.sendMessage({ type: 'am-i-driver' }, (res) => {
  if (chrome.runtime.lastError) { log('driver check failed:', chrome.runtime.lastError.message); return; }
  if (res && res.driver) {
    keepTitle();
    setInterval(tick, 3000);
  } else {
    log('dormant - not the managed driver window');
  }
});
