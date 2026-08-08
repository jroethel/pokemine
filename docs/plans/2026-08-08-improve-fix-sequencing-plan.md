# Improve fix sequencing plan (001-005)

> **For executors**: Tasks use `- [ ]` checkbox syntax; execute in dependency
> order (Task 1 first). A task is done when its acceptance check passes on
> integrated `main`. No specific tooling, skills, or agent framework is assumed -
> each `plans/00N-*.md` is a self-contained run-book any capable executor can run
> by hand.

**Goal**: harden pokemine so the live arbitrary-file-write is closed and a Google Drive-synced store can no longer corrupt-brick the app or corrupt its numbering.

**Approach**: execute the five already-vetted `plans/00N-*.md` in security-first waves, isolating the riskiest. Ship 001 alone first (the only live vulnerability), then 002 (Drive-resilience), then 004 and 005 in parallel (code-file-disjoint), then the re-scoped 003 last (it depends on 002 and rebases on 004). Each wave is its own branch/PR and its own rollback and resume unit.

**Tech stack**: Node >=20.6 (single Express 4 server), `sharp` for images, vanilla JS in `public/` (no build, no framework), JSON-on-disk store, `node --test` built-in runner. No external test, lint, or build dependencies.

**Source brief**: docs/briefs/2026-08-07-improve-plan-sequencing-brief.md

## Global constraints

- Zero new npm deps - only `express` and `sharp` at runtime; solve it in plain Node.
- No build step and no frontend framework - vanilla JS in `public/`.
- Node >=20.6 - the app relies on `node --env-file` and the built-in test runner.
- Errors reach the UI through `#error-box`, never raw `alert()`.
- z.ai base URLs stay as-is: text `https://api.z.ai/api/anthropic`, images `https://api.z.ai/api/paas/v4`; never point them at `api.anthropic.com`.
- Print layout is a fixed 63x88mm card grid in `public/style.css` - preserve it.
- House style in all copy and commits: plain `-` never the em-dash character, no section symbol, no agent co-author line.

## Dependency graph

```
Task 1 (001 path-traversal)         wave 1  - gates everything
        |
Task 2 (002 Drive-resilience)       wave 2  - after Task 1
        |
   +----+----+
   |         |
Task 3     Task 4                    wave 3  - parallel, after Task 2
(004       (005                              code-file-disjoint;
 cleanup)   app.js tests)                    shared ONLY: plans/README.md status row
   |         |
   +----+----+
        |
Task 5 (003 record-update integrity) wave 4  - after Task 2 AND Task 3
```

- Task 1 gates all: its `safe()` guard in `dir()`/`trainerDir()` underlies every later store change.
- Tasks 3 and 4 run in parallel: their code files are disjoint (Task 3 touches `lib/text.js`, `lib/store.js`, `README.md`; Task 4 touches `public/*` and `test/card-format.test.js`). They share only `plans/README.md`. Handling: each worker edits ONLY its own one-line status row (distinct lines merge cleanly), OR serialize the status-row edit as a single post-merge step done once after both land. Do not let both rewrite the whole table.
- Task 5 depends on Task 2 (its Hazard B exists because 002 makes `list()` lossy; it also needs 002's atomic `save`) AND on Task 3 (both edit `create()`; 004 lands the shared `slugify` first so 003 rebases clean).

## Human checkpoints

The brief tags no success criterion `[judgment]` - all gates are `[executed-check]`. The human checkpoints are structural, not per-task decisions:

- After each wave merges to `main`, run the FULL `npm test` on integrated `main` (all test files, not just the current plan's probe) and confirm exit 0 before starting the next wave. A wave is not done until integrated `main` is green. This catches an earlier wave's regression into a later file.
- Final batch review after wave 4: confirm all five plans' acceptance checks pass together on the final `main`, and that GitHub issues #12 (bridge CORS/PNA) and #13 (Gemini parts dedup) remain tracked as the knowingly-deferred threads.

## How to run

```bash
npm start        # node --env-file=.env server.js
npm test         # node --test test/*.test.js
```

---

## Task 1 - 001 path-traversal guard (wave 1)

- [ ] Executed end to end; acceptance check passes on integrated `main`.

**Depends on**: none.

**Files (exclusive ownership)**: `lib/store.js`, `server.js`, `test/pokemine.test.js`. Shared file: `plans/README.md` - edit ONLY this plan's status row (row-level protocol above); wave 1 is alone, so no contention.

**Interfaces (consumed by later tasks)**: adds `const SAFE_ID = /^[a-z0-9-]+$/` and `safe(id)` applied inside `dir()` and `trainerDir()`, so every later store change inherits path-safety through those two chokepoints. Later tasks must not remove or bypass `safe()`.

**Acceptance check** `[executed-check]`:

```bash
npm test
PORT=3399 DATA_DIR=/tmp/pm-probe node --env-file=.env server.js &
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "http://localhost:3399/api/bridge/jobs/..%2f..%2f..%2ftmp%2fpm-ESCAPE/result" \
  -H 'Content-Type: application/json' -d '{"b64":"aGk=","mime":"image/png"}'   # expect 400
test -e /tmp/pm-ESCAPE.png && echo "LEAKED" || echo "contained"               # expect contained
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "http://localhost:3399/api/bridge/jobs/normalid/result" \
  -H 'Content-Type: application/json' -d '{"b64":"aGk=","mime":"image/png"}'   # expect 200
kill %1; rm -rf /tmp/pm-probe /tmp/pm-ESCAPE.png
grep -n "safe(" lib/store.js   # dir/trainerDir use the guard
```

Pass: `npm test` exits 0; the probe prints `400`, `contained`, `200` in order.

**Steps**:

1. Run the plan's drift check: `git diff --stat e0825c3..HEAD -- lib/store.js server.js` (wave 1 anchors at `e0825c3`).
2. Execute `plans/001-path-traversal-guard.md` end to end.
3. Run its Done criteria block.
4. Run the full `npm test` on integrated `main`.
5. Update this task's own status row in `plans/README.md`.

---

## Task 2 - 002 store Drive-resilience (wave 2)

- [ ] Executed end to end; acceptance check passes on integrated `main`.

**Depends on**: Task 1 (shares `lib/store.js` + `server.js`; runs after so the diffs stay clean).

**Files (exclusive ownership)**: `lib/store.js`, `server.js`, `test/pokemine.test.js`. Shared file: `plans/README.md` - edit ONLY this plan's status row.

**Interfaces (consumed by later tasks)**: `list()` and `trainersList()` now SKIP unreadable records (this is precisely what creates Task 5's Hazard B); `save()` is atomic (temp + `renameSync`); `get()`/`trainerGet()` return `null` on `ENOENT` and the routes 404 on `null`. Task 5 consumes the atomic `save` shape and the lossy-`list` fact.

**Acceptance check** `[executed-check]`:

```bash
npm test
grep -n "catch" lib/store.js   # guards in list, get, trainersList, trainerGet
grep -n "\.tmp" lib/store.js   # atomic-write temp file in save
grep -n "404" server.js        # missing-record guards
```

Pass: `npm test` exits 0 with the corrupt-record-skipped and missing-id-returns-404 tests passing.

**Steps**:

1. Run the plan's drift check: `git diff --stat e0825c3..HEAD -- lib/store.js server.js`. Sanctioned drift after wave 1: 001's `safe()` guard - proceed, do not STOP on it.
2. Execute `plans/002-store-drive-resilience.md` end to end.
3. Run its Done criteria block.
4. Run the full `npm test` on integrated `main`.
5. Update this task's own status row in `plans/README.md`.

---

## Task 3 - 004 dead-code + README cleanup (wave 3, parallel with Task 4)

- [ ] Executed end to end; acceptance check passes on integrated `main`.

**Depends on**: Task 2 (touches `lib/store.js` after 002 has settled it).

**Files (exclusive ownership)**: `lib/text.js`, `lib/store.js`, `README.md`, and (only if the optional Step 4 is done) `lib/text-providers.js`, `lib/providers.js`. Shared file: `plans/README.md` - edit ONLY this plan's status row; Task 4 runs concurrently, so touch only your one line, or defer the row edit to a single post-merge step done once after both land.

**Interfaces (consumed by later tasks)**: `create()` now calls the shared `slugify(record.stages[0].name)` instead of the inlined chain. Task 5 edits `create()` on top of this, so it must land before Task 5.

**Acceptance check** `[executed-check]`:

```bash
npm test
grep -n "gemini-flash-latest" lib/text.js   # dead URL const gone -> no matches
grep -n "replace(/\[\^a-z0-9\]" lib/store.js # only the slugify def, no inline copy in create
grep -n "CANON_FILE" README.md               # at least one match
```

Pass: `npm test` exits 0; the dead-const and inline-slugify greps return empty (only the `slugify` definition remains); the README grep matches `CANON_FILE`.

**Steps**:

1. Run the plan's drift check: `git diff --stat e0825c3..HEAD -- lib/text.js lib/store.js README.md`. Sanctioned drift after wave 2: 001+002 changed `lib/store.js` - compare `create()` against the plan's excerpt by symbol and proceed on a benign match.
2. Execute `plans/004-cleanup-deadcode-and-readme.md` end to end.
3. Run its Done criteria block.
4. Run the full `npm test` on integrated `main`.
5. Update this task's own status row in `plans/README.md` (own row only - Task 4 is concurrent).

---

## Task 4 - 005 extract app.js pure logic and unit-test it (wave 3, parallel with Task 3)

- [ ] Executed end to end; acceptance check passes on integrated `main`.

**Depends on**: Task 2 (sequencing only; no code-file overlap with Task 2, but runs in the post-002 wave order).

**Files (exclusive ownership)**: `public/card-format.js` (new), `public/app.js`, `public/index.html`, `test/card-format.test.js` (new). Shared file: `plans/README.md` - edit ONLY this plan's status row; Task 3 runs concurrently. These code files are disjoint from Task 3's, so the two can proceed truly in parallel.

**Interfaces (consumed by later tasks)**: none downstream - this is a frontend/test-only extraction. It adds a new test file to the suite that wave 4's integrated `npm test` will also run.

**Acceptance check** `[executed-check]`:

```bash
npm test
grep -n "const esc =" public/app.js         # no matches (moved out)
grep -n "card-format.js" public/index.html  # one <script>, before app.js
```

Pass: `npm test` exits 0 with `test/card-format.test.js` passing; no `const esc =` remains in `public/app.js`.

**Steps**:

1. Run the plan's drift check: `git diff --stat e0825c3..HEAD -- public/app.js`. If `app.js` changed, re-locate the target functions by symbol, not line number.
2. Execute `plans/005-extract-app-logic-tests.md` end to end.
3. Run its Done criteria block.
4. Run the full `npm test` on integrated `main`.
5. Update this task's own status row in `plans/README.md` (own row only - Task 3 is concurrent).

---

## Task 5 - 003 record-update integrity (wave 4)

- [ ] Executed end to end; acceptance check passes on integrated `main`.

**Depends on**: Task 2 (hard: Hazard B exists only because 002 makes `list()` lossy, and the counter reuses 002's atomic-write shape) AND Task 3 (both edit `create()`; 004's shared `slugify` lands first so 003 rebases clean).

**Files (exclusive ownership)**: `lib/store.js`, `server.js`, `test/pokemine.test.js`. Shared file: `plans/README.md` - edit ONLY this plan's status row; wave 4 is alone, so no contention.

**Interfaces (produced)**: a persisted monotonic counter file at `<DATA_DIR>/counters.json` (fields `dex`, `collector`), the source of truth for all new numbers; a `store.allocCollector()` export used by the evolve route; a re-read-after-await contract for any route that reads-then-saves a record.

**Acceptance check** `[executed-check]`:

```bash
npm test
grep -n "allocCollector\|bumpCounter\|initCounters" lib/store.js  # counter wired in
grep -n "withLock\|await store.create" lib/store.js server.js     # empty: no mutex, no async ripple
```

Pass: `npm test` exits 0 with the concurrent-evolve test (record reaches 3 stages, no lost update) and the transiently-unreadable-record test (numbers do not reuse) both passing; the no-mutex/no-async grep returns empty.

**Steps**:

1. Run the plan's drift check anchored to the tip of wave 3 (not `e0825c3`): `git diff --stat <wave-3-tip>..HEAD -- lib/store.js server.js`. Sanctioned drift: 001's `safe()`, 002's guarded `list`/`get` + atomic `save` + 404s, and 004's shared `slugify` in `create()` - proceed on these, STOP only on structural mismatch of `create()`/`nextNumber()`/the evolve+alter route tails.
2. Execute `plans/003-serialize-number-allocation.md` end to end (confirm the two new tests FAIL before the fix - the teeth check).
3. Run its Done criteria block.
4. Run the full `npm test` on integrated `main`.
5. Update this task's own status row in `plans/README.md`.

---

## Sequencing rules (bind across all tasks)

- **Sanctioned drift by wave**: every plan drift-checks against `e0825c3`, but each wave changes `lib/store.js` and `server.js`. After wave 2 those files differ from `e0825c3` (001+002); after wave 3 `create()` uses the shared `slugify` (004). An executor hitting a drift-check STOP on exactly these already-landed changes should PROCEED, not halt. Re-anchor a plan's drift check to the tip of the prior wave when running strictly (wave 4 / Task 5 does this explicitly).
- **Resume and rollback unit**: each wave is its own branch(es)/PR and is the rollback and resume unit. On interruption (quota, crash), relaunch the incomplete wave from scratch rather than resuming a half-applied plan.
- **Integrated-main gate**: after each wave merges, the full `npm test` on integrated `main` must exit 0 before the next wave starts. A wave is not done until integrated `main` is green.
- **Parking lot (tracked, not in these tasks)**: bridge CORS/PNA hardening (GitHub #12) and Gemini parts-extraction dedup (GitHub #13, gated as optional Step 4 in Task 3) stay deferred and tracked on GitHub.
