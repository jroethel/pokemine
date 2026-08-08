# Pokemine

A kid-facing web app that generates Pokemon-style creature cards (text + art) from a typed idea.
Single Express server, no-build vanilla-JS frontend, JSON-on-disk store.

## Read these first

- `docs/reference/architecture.md` - how it works, file by file. The source of truth for "what does this file do".
- `docs/reference/prompt-manual.md` - every text/image prompt string and which knob changes it.
- `config/repo-state.md` - the loop repo-state convention (roadmap, issues, backlog, handoffs, archive). GitHub is the tracker.

## Load-bearing at runtime (do not treat as "just docs")

- `docs/reference/canon-pack.md` is injected into the system prompt on **every** text generation, via `CANON_FILE` (set in `.env`/`.env.example`).
  Deleting or moving it, or pruning `docs/reference/` as stale docs, silently breaks generation.
- `docs/reference/notebook-cache/` is the raw NotebookLM source cache; `scripts/refresh-notebook-cache.py` writes it and re-distills `canon-pack.md` + `pokemon-design-notes.md` from it. Editing lore never touches code.

## House constraints (preserve on any change)

- Zero new npm deps. The only runtime deps are `express` and `sharp`; solve it in plain Node first.
- No build step and no framework on the frontend. It is vanilla JS in `public/`.
- Node >=20.6 (the app relies on `node --env-file` and the built-in test runner).
- Errors reach the UI through `#error-box`, never raw `alert()`. (Issue #1 tracks the 3 legacy `alert()` paths in `public/app.js`.)
- The z.ai base URLs are deliberate: text `https://api.z.ai/api/anthropic` (GLM via the Anthropic-shaped API) and images `https://api.z.ai/api/paas/v4`. Never point these at `api.anthropic.com`.
- Text provider: the code default is `gemini`; `TEXT_PROVIDER` in `.env` overrides it, and a kid can switch per-browser via the words-by selector.
- Print layout is a fixed 63x88mm card grid in `public/style.css`. Preserve it.
- House style in all copy and commits: plain `-` never the em-dash character, no section symbol, and no agent co-author line in commit messages.

## Run and test

```bash
npm start        # node --env-file=.env server.js
npm test         # node --test test/*.test.js
```
