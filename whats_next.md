# What's Next

Status as of 2026-07-16 (evening).
Branch `feat/faster-kinder-generation` is code complete, hardened, 45/45 tests, automated E2E green, NOT merged.
Ground truth: `docs/superpowers/HANDOFF-faster-kinder-generation.md`.

## Blocking the merge (needs you)

1. **Chromebook SSE check (Decision 1).**
   Start the server if it isn't running: `PORT=3311 DATA_DIR=/tmp/pokemine-scratch node --env-file=.env server.js`.
   On the Chromebook, open the server at the Mac's current LAN IP (e.g. `http://192.168.1.116:3311` - re-check with `ipconfig getifaddr en0`; the router reassigns this), provider `mock`, Generate.
   Phases animate (Poke Ball -> Ultra Ball) then a card: streaming works, merge is unblocked.
   Spinner hangs with no phase changes: tell the next session "Chromebook SSE failed" and it adds the blocking-JSON fallback flag (small, planned).

2. **Real-bridge run (E2E #4).**
   Brave with the Bridge extension loaded + signed-in `gemini.google.com` tab, art provider `bridge`.
   Expect a >120s generation to succeed (server-driven deadline) and, with the tab closed, a fast "Helper not connected".
   Per the handoff: if this is flaky, do NOT block the merge; log it and watch.

3. **Merge**, once 1 passes: `git checkout main && git merge --no-ff feat/faster-kinder-generation`.

## Loose ends (small, anytime)

- Commit the two learning-guide edits (`learning_guide.html`, `learning_guide_kids.html`) - still uncommitted by design, doc-only.
- Delete `list-api-mcp.txt` and `todo.txt` from the repo root, or move them somewhere intentional (untracked scratch).
- The 3311 scratch server may still be running from this session: `kill $(lsof -ti :3311)`.

## Backlog (pre-existing, noted during review - none caused by this branch)

- Raw `alert(e.message)` remains in the delete, patch, and archive UI paths (`public/app.js` lines ~354/386/484); migrate them to the `#error-box` for consistency with the create path.
- No client-abort handling on the SSE create route: closing the tab mid-generation lets the server run to completion (up to the 300s bridge deadline) and write to a dead socket. Harmless today; add `req.on('close')` if it ever matters.
- Orphan-card pattern: `store.create()` persists with `art:null` before `saveArt`/`save`, so a disk error there leaves a card without art. The new SSE error event now at least tells the kid; a cleanup pass could delete the orphan.
- Bridge image-detection heuristic (`complete && naturalWidth>200`, newest-image-wins) is the known weak point (Decision 2). Watch after deploy; Playwright-over-CDP is the deferred fallback if detection stays flaky.

## Decided this session (context for the next one)

- Text default is GLM: `.env` has `TEXT_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (the Z.AI key, z.ai endpoint - not Anthropic's API). Gemini text was running 65-120s with "high demand" failures; GLM does it in 3-5s. Kids can still switch via the words-by selector, and a browser with `localStorage.textProvider` set overrides the default.
- Commit `e9b4e04` fixed the post-header error-handler bug (SSE error event instead of a doomed 500) and mapped Gemini's "high demand" message to "The lab is busy".
