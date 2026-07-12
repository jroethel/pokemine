// Fetch proxy for the content script. Content scripts on gemini.google.com can't
// call http://localhost:3000 (CORS + mixed-origin); this service worker can,
// because the manifest grants host_permissions for localhost.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'fetch') return;
  const opts = { method: msg.method || 'GET', headers: { 'Content-Type': 'application/json' } };
  if (msg.body !== undefined) opts.body = JSON.stringify(msg.body);
  fetch('http://localhost:3000' + msg.path, opts)
    .then(async r => sendResponse({ ok: r.ok, status: r.status, data: await r.json().catch(() => null) }))
    .catch(e => sendResponse({ ok: false, error: String(e) }));
  return true; // keep the message channel open for the async response
});
