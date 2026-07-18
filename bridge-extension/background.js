// Fetch proxy for the content script. Content scripts on gemini.google.com can't
// call http://localhost:3000 (CORS + mixed-origin); this service worker can,
// because the manifest grants host_permissions for localhost.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'fetch') {
    if (msg.type === 'am-i-driver') {
      sendResponse({ driver: sender.tab && sender.tab.id === driverTabId });
    } else if (msg.type === 'open-driver') {
      openDriverWindow();
    }
    return false;
  }
  const opts = { method: msg.method || 'GET', headers: { 'Content-Type': 'application/json' } };
  if (msg.body !== undefined) opts.body = JSON.stringify(msg.body);
  fetch('http://localhost:3000' + msg.path, opts)
    .then(async r => sendResponse({ ok: r.ok, status: r.status, data: await r.json().catch(() => null) }))
    .catch(e => sendResponse({ ok: false, error: String(e) }));
  return true; // keep the message channel open for the async response
});

// Dedicated, always-visible gemini window. A backgrounded gemini tab gets
// timer-throttled by Chrome and Gemini itself pauses inference on
// visibilitychange, so jobs stall until the tab is manually activated. This
// popup stays visible in the corner and hosts the only content script allowed
// to drive jobs, so generation runs unthrottled even when the user is elsewhere.
const DRIVER_WIN = { url: 'https://gemini.google.com/', type: 'popup', width: 420, height: 640, left: 40, top: 40 };
let driverWinId = null, driverTabId = null;

// Liveness probe so we only keep the driver window around when there's a server
// actually wanting jobs. Connection refused (server down) resolves fast - no hang.
function serverUp() {
  return fetch('http://localhost:3000/api/config')
    .then(r => r.ok)
    .catch(() => false);
}

function openDriverWindow() {
  if (driverWinId !== null) return;
  chrome.windows.create(DRIVER_WIN, (win) => {
    driverWinId = win.id;
    driverTabId = win.tabs[0] && win.tabs[0].id;
  });
}
// No auto-open on browser start or extension reload - the window opens on demand
// from the toolbar popup, and reopens on accidental close while the server is up.
// Reopen on close ONLY if the server is running. If Pokemine isn't up, closing
// the window should keep it closed - no point driving a window for a dead server.
chrome.windows.onRemoved.addListener((winId) => {
  if (winId !== driverWinId) return;
  driverWinId = null;
  driverTabId = null;
  serverUp().then(up => { if (up) openDriverWindow(); });
});
