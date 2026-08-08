# Handoff: Faster, Kinder, Never-Empty Generation

**Status:** CODE COMPLETE + independently re-verified, NOT merged. E2E 1-3 and bridge-offline PASS (automated Playwright, 2026-07-16 follow-up session). Remaining: Chromebook SSE check (Decision 1) and the real-bridge success path.
**Date:** 2026-07-16, updated same day by the follow-up session. **For:** the next session picking this up.

## Follow-up session results (2026-07-16 evening)

- Suite re-run independently: green. Adversarial Opus review of `main..HEAD`: pass, one major finding, fixed and committed as `e9b4e04`:
  - `server.js` error handler now guards `res.headersSent`: a throw after SSE headers flushed (store/save/log run post-header, outside the route try/catch) used to hit `res.status(500)`, throw ERR_HTTP_HEADERS_SENT, and truncate the stream with no error event. It now emits an SSE `error` event. Test proven red without the guard.
  - `friendly-errors.js`: Gemini's real "experiencing high demand" message now maps to "The lab is busy" (was falling to the generic box). Caught live in E2E when Gemini actually failed under demand.
- Suite is now **45/45**.
- Automated E2E (Playwright, three server configs): S1 happy path PASS (Poke -> Ultra phases, card, `outcome=ok`); S2 art-failed PASS (broken zai art key + anthropic/GLM text: "Caught it... almost!" box, card with Redraw, `outcome=art-failed`); S3 text error PASS (friendly box, no orphan card); bridge-offline PASS (0.2s fail-fast, "Helper not connected").
- Bonus: the anthropic (z.ai GLM) text provider is now E2E-verified, and it ran text in **3.4s** while Gemini took 65-120s under high demand. The words-by selector already lets kids switch.
- Known-and-fine: a bad Gemini API key shows the generic "Hmm, that's weird" (no rule matches an invalid-key message); kids never touch keys, so this stays.
- Reviewer minors, all pre-existing and left alone per surgical-changes rules: raw `alert()` in delete/patch/archive paths, no client-abort handling on the SSE route, orphan-card-on-disk-error pattern in `store.create`.

## TL;DR

The faster/kinder generation plan was routed **ONE AGENT** (only the Strong tier was available: Opus 4.8 / GLM 5.2), executed by a background Opus subagent via `/loop-drive`, and independently gated.
All code for T1-T5 is committed on `feat/faster-kinder-generation`.
**43/43 tests green** (25 baseline + 18 new).
What remains is manual E2E (needs a browser and the real device) and two decisions only Jeremy can make.

## Branch state

- Branch: `feat/faster-kinder-generation`, 5 commits ahead of `main`, NOT merged. Main is untouched.
- Base: `main @ e8515b3`.
- Commits (oldest first):
  1. `de3f335` feat(text): pluggable text provider registry (gemini/anthropic/openai via fetch)  - T1, +6 tests
  2. `1857344` fix(bridge): server-driven deadline replaces hardcoded 120s; poll 1.5s; detect decoded images  - T2, +2 tests
  3. `c9128ff` feat(create): SSE phases, art-failed mockup fallback, timing log, bridge-offline guard  - T3, +4 tests
  4. `e6d114f` feat(ui): kid-friendly error box replaces raw alert  - T4, +6 tests
  5. `bffa994` feat(ui): SSE-driven Poke Ball phase overlay + words-by selector  - T5, +0 tests (frontend only)
- Suite: **43/43 pass**, re-run independently by the orchestrator (not just the worker's report).

## What IS verified

- **Server-side SSE-over-POST:** `test/create-sse.test.js` drives the real server through Node `fetch` + `getReader` and asserts the `phase` / `done` / `error` event contract. Solid.
- **Placeholder fallback + timing log + bridge-offline guard:** covered by the create-sse test.
- **Friendly error mapper:** 6 unit tests (`test/friendly-errors.test.js`).
- **Text-provider registry** (gemini / anthropic / openai via z.ai): 6 unit tests. Anthropic base URL pinned to `https://api.z.ai/api/anthropic`, never `api.anthropic.com`.
- **Constraint compliance:** zero new deps; ephemeral ports in tests; `DATA_DIR` tmpdirs per test file; no em dash and no section symbol in the diff (grepped); gemini stays the text default; no raw `alert()` in the UI path.
- **The two worker deviations** (adapting existing tests for the new SSE contract, and adding a bridge ping) were audited at the gate: assertion-equivalent, and the ping hits a pre-existing endpoint for the right reason. Details in `learning_guide.html`, "Reliability-generation learnings (2026-07-15/16)".

## What is NOT verified (blocked on Jeremy)

### Manual E2E (run on your machine, not the agent's)

Start the server: `PORT=3311 DATA_DIR=/tmp/pokemine-scratch node --env-file=.env server.js`, then open http://localhost:3311.

1. **Mock happy path:** art provider = `mock`, type an idea, Generate. Expect Poke Ball -> Ultra Ball -> card renders; `/tmp/pokemine-scratch/generation.log` shows `outcome=ok`.
2. **Art-failed path:** break the image (bad key, or make `mock` throw), Generate. Expect phases run -> card with blank placeholder + friendly "Caught it... almost!" box -> Redraw retries just the picture; log shows `outcome=art-failed`.
3. **Text error:** bad Gemini key, Generate. Expect friendly "The lab is busy" box, no orphan card.
4. **Real bridge:** load the Bridge ext in Brave, signed-in `gemini.google.com` tab, art provider = `bridge`. Expect a >120s generation to SUCCEED (server-driven deadline); with the tab/ext closed, Generate fails FAST with "Helper not connected" instead of a hang.

### Decision 1: SSE-over-POST on the Chromebook (THE open question)

Server-side streaming is proven (Node `fetch`). The unknown is whether the **Chromebook's** browser `fetch` streams a POST response body. Run E2E #1 on the actual Chromebook.

- **If it works:** keep the streaming as written.
- **If it blocks:** the plan's fallback is a blocking-JSON flag behind config (loses the Poke Ball phase animation; keeps the placeholder card, friendly errors, and timing log). Adding it is small; a fresh agent or a direct edit can do it.

### Decision 2: bridge image-detection brittleness

The `complete && naturalWidth>200` heuristic is the known weak point (the plan flags it in Risks). Nothing to decide now. Watch it after deploy; Playwright-over-CDP is the deferred fallback if detection stays flaky.

## Courses of action (pick when back)

- **E2E passes AND Chromebook SSE works** -> merge to main: `git checkout main && git merge --no-ff feat/faster-kinder-generation`. Optionally delete the branch after.
- **Chromebook SSE fails** -> add the blocking-JSON fallback flag first (fresh `/loop-drive` pass or direct edit), re-verify, then merge.
- **Real-bridge E2E flaky** -> do NOT block the merge on it; log it and watch. Playwright fallback is a separate, later task.
- **You want none of it yet** -> the branch sits safely; main is untouched.

## Files touched (cumulative, `main..HEAD`)

New: `lib/text-providers.js`, `public/friendly-errors.js`, `test/text-providers.test.js`, `test/bridge-reliability.test.js`, `test/create-sse.test.js`, `test/friendly-errors.test.js`.
Modified: `lib/text.js`, `lib/providers.js`, `server.js`, `bridge-extension/content.js`, `public/app.js`, `public/index.html`, `public/style.css`, `.env.example`, and `test/pokemine.test.js` (adapted for the SSE contract - audited as assertion-equivalent).
Total: +500/-45 across 15 files.

## Global constraints to preserve on any follow-up

Zero new npm deps. Never bind port 3000 in tests/scratch. Each new test file sets `process.env.DATA_DIR` to a fresh tmpdir at the top before any `require()`. No em dash and no section symbol in any copy. Text default: Jeremy switched to GLM on 2026-07-16 via `.env` (`TEXT_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`=the Z.AI key); the code-level fallback stays `gemini` when env is unset, and the "defaults to gemini" unit test still holds. Anthropic base URL stays `https://api.z.ai/api/anthropic`. Errors reach the UI only via `#error-box`, never raw `alert()`. Preserve the 63x88mm print layout.

## Also done this session (uncommitted, doc-only)

- `learning_guide.html`: new "Reliability-generation learnings (2026-07-15/16)" section + decisions table.
- `learning_guide_kids.html`: new "Skill 6: Making it faster" section.
- These edits are left uncommitted (you didn't ask to commit). Commit them with the branch, on main, or separately when ready.

## How to resume

Git is ground truth. A fresh session reads this file, runs `git log main..feat/faster-kinder-generation`, runs `npm test`, and picks a course of action above. The implementation plan stays at `docs/superpowers/plans/2026-07-15-pokemine-faster-kinder-generation.md`. Background agents do NOT persist across sessions, so do not try to resume the old Opus worker by ID - drive any follow-up as a new `/loop-drive` pass or a direct edit.
