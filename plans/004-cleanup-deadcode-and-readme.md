# Plan 004: Remove dead code + fix README env vars

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report - do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e0825c3..HEAD -- lib/text.js lib/store.js README.md`
> On any mismatch with the "Current state" excerpts, treat as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `e0825c3`, 2026-08-07

## Why this matters

Three tiny hygiene items and one onboarding fix, none behavior-changing:
a dead endpoint constant that a maintainer could mistake for the live one, a
duplicated slug rule that can silently diverge, and a README that omits the
single most load-bearing env var (`CANON_FILE`) - a partial `.env` breaks text
generation with no obvious cause. Cheap to fix, each removes a real future
foot-gun.

## Current state

- **Dead constant**: `lib/text.js:4` defines
  `const URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';`
  It is referenced nowhere in `lib/text.js` (all text calls route through
  `getTextProvider`). The live copy is `GEMINI_URL` in `lib/text-providers.js:4`.
- **Duplicated slug rule**: `lib/store.js:14-15` defines
  `const slugify = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');`
  but `create()` (`lib/store.js:33-34`) inlines the identical chain instead of
  calling it:
  ```js
  const slug = (record.stages[0].name || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'pokemon';
  ```
- **README gap**: `README.md` "Setup (once)" lists `GEMINI_API_KEY`,
  `ZAI_API_KEY`, `DATA_DIR` only. It never mentions `CANON_FILE`
  (in `.env.example` and flagged load-bearing in `CLAUDE.md`) or the
  `TEXT_PROVIDER` / `ANTHROPIC_*` / `OPENAI_*` vars. `.env.example` is the full list.

Note on DEBT-02 (Gemini parts-extraction repeated in `lib/text.js:68-71`,
`lib/text-providers.js:6-8`, `lib/providers.js:52`): assessed low-urgency and the
shapes are stable. It is OPTIONAL in this plan (Step 4) and gated - skip it if it
touches more than the three sites listed.

## Commands you will need

| Purpose | Command      | Expected on success   |
|---------|--------------|-----------------------|
| Tests   | `npm test`   | all pass (48)         |
| Grep    | `grep -rn "URL" lib/text.js` | after Step 1: only usages you kept, no lone dead const |

## Scope

**In scope**:
- `lib/text.js` (delete dead const; optional Step 4)
- `lib/store.js` (use the shared `slugify` in `create`)
- `lib/text-providers.js`, `lib/providers.js` (only if you do optional Step 4)
- `README.md`

**Out of scope**:
- Any behavior change to slug output - the inline chain and `slugify` are
  byte-identical; this is a pure dedup, output must not change.
- The provider registries' structure (see plans/README.md rejected list - do not
  merge them).

## Git workflow

- Branch: `advisor/004-cleanup-deadcode-and-readme`
- Commit style: conventional commits, e.g. `refactor(store): use shared slugify`;
  `docs(readme): document CANON_FILE and provider env vars`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Delete the dead URL constant

Remove `lib/text.js:4` (the `const URL = '...gemini-flash-latest...'` line).
Confirm it is unused first.

**Verify**:
```
grep -n "\bURL\b" lib/text.js   # expected: no matches (or only unrelated substrings, none a bare `URL` reference)
npm test                         # all pass
```

### Step 2: Use the shared slugify in create()

In `lib/store.js` `create()`, replace the inlined chain (lines 33-34) with the
existing helper:

```js
const slug = slugify(record.stages[0].name) || 'pokemon';
```

`slugify` already handles the null case (`s || ''`), so `|| 'pokemon'` still
covers an empty result.

**Verify**:
```
npm test   # all pass - the "create/list/get round trip" test asserts rec.id matches /^gyatt-/, proving slug output is unchanged
```

### Step 3: Document the env vars in README

In `README.md` "Setup (once)", add `CANON_FILE` and a pointer to `.env.example`.
Keep house style: plain `-`, one sentence per line. Add lines like:

```
- `CANON_FILE` - path to the canon pack appended to every text prompt; must point at an existing file or text generation fails (default `docs/reference/canon-pack.md`)
- `TEXT_PROVIDER` - which text model to use (`gemini` default; `anthropic`/`openai` route to GLM via z.ai). See `.env.example` for the full list of variables.
```

**Verify**: `grep -n "CANON_FILE" README.md` -> matches.

### Step 4 (OPTIONAL - gated): Dedup Gemini parts-extraction

Only do this if it stays confined to exactly these three sites and all tests stay
green; otherwise SKIP and leave a note. Add one helper (e.g. in
`lib/text-providers.js`) that returns `candidates[0].content.parts`, and have
`extractText` (`lib/text-providers.js:6-8`), `extractJSON` (`lib/text.js:68-71`),
and the inline `parts.find(p => p.inlineData)` in `lib/providers.js:52` call it.
Keep `extractJSON` as a thin `JSON.parse(...)` wrapper so its existing test still
passes.

**Verify**: `npm test` -> all pass. If it required touching anything beyond those
three call sites, revert Step 4 and record "DEBT-02 deferred" in the plan status.

## Test plan

- No new tests required - these are non-behavioral. The existing suite is the
  guard: the round-trip test pins slug output (Step 2), and the full suite pins
  text/image extraction (Step 4 if done).
- Verification: `npm test` -> all 48 pass, unchanged count (unless you add none).

## Done criteria

ALL must hold:

- [ ] `npm test` exits 0
- [ ] `grep -n "gemini-flash-latest" lib/text.js` -> no matches (dead const gone)
- [ ] `grep -n "replace(/\[\^a-z0-9\]" lib/store.js` -> only the `slugify` definition (line ~15), not a second inline copy in `create`
- [ ] `grep -n "CANON_FILE" README.md` -> at least one match
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Deleting the `URL` const breaks any test - it would mean it wasn't dead; report.
- The slug round-trip test's `rec.id` assertion changes - output diverged, revert Step 2.
- Optional Step 4 spreads beyond the three named sites - skip it, don't force it.

## Maintenance notes

- Keep a single `slugify`; any future slug tweak (max length, unicode) then lands
  in one place.
- README and `.env.example` should stay in sync; `.env.example` is the source of
  truth for the var list.
