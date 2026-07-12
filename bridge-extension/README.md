# Pokemine Bridge (Brave extension)

Driver for the `bridge` image provider.
It routes Pokemine's image generation through the consumer Gemini web app instead of the paid API, by driving a signed-in `gemini.google.com` tab.

## Load it in Brave

1. Open `brave://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `bridge-extension/` folder.

## Run the driver

- The Pokemine server must be running on `http://localhost:3000` (`npm start`).
- Keep a **`gemini.google.com` tab open and signed in** in the same Brave profile.
  The content script only runs on that tab, and it needs your logged-in session to generate.
- With both in place, pick **bridge** in Pokemine's provider dropdown.
  When the tab is driving, the dropdown shows `bridge`; otherwise `bridge (driver offline)`.

Open the Gemini tab's DevTools console to watch progress lines prefixed `[pokemine-bridge]`.
The driver polls every 3s, runs one job at a time, and posts each result (or error) back to the server.

## How it works

- `content.js` polls `GET /api/bridge/jobs`, drives the Gemini editor (New chat -> type prompt -> Send), waits for the new image, canvas-extracts it to a PNG, and posts it to `POST /api/bridge/jobs/:id/result`.
- `background.js` is a fetch proxy: content scripts on `gemini.google.com` can't call `localhost` directly (CORS), but the service worker can via `host_permissions`.

## Caveat

Automating the consumer Gemini web app violates Google's Terms of Service (see the Plan B spec).
Use it knowingly. The paid `gemini` API provider is the clean path; the bridge exists only to avoid API cost, and it breaks whenever Google changes the Gemini UI.
