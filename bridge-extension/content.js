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
const bigImages = () => [...document.querySelectorAll('img')].filter(im => im.naturalWidth > 200);

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

async function waitForNewImage(baseline) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const imgs = bigImages();
    if (imgs.length > baseline) return imgs[imgs.length - 1]; // newest is the result
  }
  throw new Error('no image appeared within 120s');
}

// Direct fetch(img.src) on the blob: URL can fail; canvas extraction is reliable.
function extractPngB64(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas.toDataURL('image/png').split(',')[1]; // strip the "data:image/png;base64," prefix
}

async function runJob(job) {
  log('running job', job.id, '-', job.prompt);
  try {
    await startNewChat();
    await enterPrompt(job.prompt);
    const baseline = bigImages().length;
    await clickSend();
    log('submitted, waiting for the image (~18s typical)...');
    const img = await waitForNewImage(baseline);
    const b64 = extractPngB64(img);
    await proxy(`/api/bridge/jobs/${job.id}/result`, 'POST', { b64, mime: 'image/png' });
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

log('driver loaded on', location.href);
setInterval(tick, 3000);
