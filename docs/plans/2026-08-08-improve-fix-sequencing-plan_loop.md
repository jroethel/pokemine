# Improve-fix sequencing - loop orchestration plan

## 1. What this file is

This is the agent-orchestrated execution plan compiled from `docs/plans/2026-08-08-improve-fix-sequencing-plan.md`.
It is what one frontier-model session drives; the source plan remains the manual fallback.
The five `plans/00N-*.md` run-books stay ground truth for each unit's scope, acceptance criteria, and STOP conditions.
Any spec edit made during the run is applied back to the relevant `plans/00N-*.md` (or the source sequencing plan), not just here.
Transport is ringer for every unit (the Step 0 route); there are no Agent-tool units in this build.

## 2. Routing table

Every unit rides ringer on the `claude-zai` engine at model `glm-5.2` (the flat-rate lane, and the proven on-type pick).
`Val` is the executed ringer `check` for that unit (check-only); there is no separate review task, the orchestrator gate supplies the adversarial layer.

| Unit           | Wave | task_type    | Model   | Transport | Engine     | Impl | Val   | Evidence      |
| -------------- | ---- | ------------ | ------- | --------- | ---------- | ---- | ----- | ------------- |
| 001-traversal  | 1    | code-fix     | glm-5.2 | ringer    | claude-zai | high | check | posterior[^1] |
| 002-resilience | 2    | code-fix     | glm-5.2 | ringer    | claude-zai | high | check | posterior[^2] |
| 004-cleanup    | 3    | code-fix     | glm-5.2 | ringer    | claude-zai | med  | check | posterior[^3] |
| 005-extract    | 3    | code-feature | glm-5.2 | ringer    | claude-zai | med  | check | posterior[^4] |
| 003-integrity  | 4    | code-fix     | glm-5.2 | ringer    | claude-zai | high | check | posterior[^5] |

[^1]: 001-traversal: glm-5.2 (claude-zai) is proven on code-fix, 12 tasks at 100% first-try on the local scoreboard, and the loop-stack build-wave logged code-fix x3 at attempt-1 PASS with exact ownership lists. High impl effort because this is a security guard that gates every later store change (risk concentration), even though the diff is small.

[^2]: 002-resilience: same code-fix posterior. High because the atomic-write and 404 changes are a store contract that later waves build on (contract design).

[^3]: 004-cleanup: same code-fix posterior. Medium because the work is mechanical and non-behavioral (delete a dead const, dedup to the existing `slugify`, add README lines), heavily referenced by the plan. This is the natural exploration slot if the human later wants to audition a cheaper/free model on a low-stakes lane; kept on glm-5.2 here for a predictable first run.

[^4]: 005-extract: glm-5.2 (claude-zai) is proven on code-feature, 41 tasks at 80% first-try (83% pass); MODEL-NOTES reads several of the fail rows as misattributed orchestrator check-bugs (repo-wide format/mypy gates crossing task ownership), so the posterior is undepressed, and the TDD-spec-with-embedded-test lane is called fully reliable. Medium because the extraction is behavior-preserving with a verbatim exemplar (`public/friendly-errors.js`) to copy.

[^5]: 003-integrity: same code-fix posterior. High because numeric correctness and the concurrent-evolve lost-update window are at stake, and the two new tests are teeth-tested (must fail before the fix). Not pinned away from glm-5.2: the only stronger ringer alternative (codex) has zero trusted local rows on this workload, so routing off a 100%-on-type proven model on a "seems hard" feeling is the anti-pattern the routing chain exists to prevent. Risk is answered with high effort, a teeth-verified check, and the deepest orchestrator gate, not a model swap.

## 3. Orchestration shape and validation layers

One orchestrator session drives four dependent waves.
The integration branch `integration/improve-fix-loop` IS the repo HEAD; ringer cuts each wave's worktrees from that HEAD, so every wave builds on the prior wave's merged result.

```
orchestrator (this session)  --  integration/improve-fix-loop == repo HEAD
|
├─ wave 1: 001-traversal    ringer/claude-zai glm-5.2 (high) ─> check: npm test + live traversal probe
|     gate: apply patch, npm test on integration, distill, MODEL-NOTES receipt
├─ wave 2: 002-resilience   ringer/claude-zai glm-5.2 (high) ─> check: npm test + guard/atomic/404 greps
|     gate: apply patch, npm test on integration, distill
├─ wave 3: 004-cleanup  ┐   ringer/claude-zai glm-5.2 (med)  ─> check  (max_parallel 2, disjoint files)
|          005-extract  ┘   ringer/claude-zai glm-5.2 (med)  ─> check
|     gate: apply both patches, npm test on integration, distill
└─ wave 4: 003-integrity    ringer/claude-zai glm-5.2 (high) ─> check: npm test + teeth-verified tests
      gate: deep adversarial re-derive, npm test, advisory /loop-review, final human checkpoint
```

Three validation layers per unit:

1. Implementer self-check: the worker runs `npm test` and the plan's Done-criteria block in its worktree before returning.
2. Per-unit validator: the executed ringer `check` (the primary, non-negotiable gate) built on the source plan's acceptance-check block, printing WHY on any failure and exporting the deliverable patch.
3. Orchestrator gate: reads the run JSON and raw logs, re-derives the check's steps against the tree for the high-stakes units (001, 002, 003), applies the reviewed patch to the integration branch, and reruns the full suite there.

## 4. Hazard mitigations (deviations from the source plan marked)

Run-level `"worktrees": true` handles isolation, per-task directories, and log separation; those are not re-specified.
The ringer-transport footguns this plan MUST carry:

- Deliverables die with a passing worktree (it is deleted on pass), so each `check` exports the worker's uncommitted edits with the patch-export pattern `git add -A && git diff --cached > /tmp/improve-fix-sequencing/exports/<key>.patch`, and the orchestrator applies that patch on the integration branch after review.
- Gitignored outputs caveat: none of the five units produce a gitignored deliverable (all deliverables are tracked source files; `counters.json` is a runtime file under `DATA_DIR`, never a repo deliverable), so no explicit `cp`-outside-worktree is needed beyond the patch. The `git add -A` in each check will not stage the gitignored `node_modules` symlink or any `.env`, which is correct.
- No opencode units in this build, so the opencode-stagger caveat does not bind; `max_parallel: 2` on wave 3 is safe on the claude-zai engine.

Worktree-environment hazards specific to this repo (NOT in the source plan - these are the compile's additions):

- `node_modules` is gitignored, so a fresh worktree has none and `npm test` would fail with "Cannot find module 'express'". Mitigation (deviation): both the spec and the check run `test -e node_modules || ln -s /Users/jjrdar/create/pokemine/node_modules node_modules` first, symlinking the shared, already-installed deps (express + sharp) from the main checkout. `node_modules` is an out-of-worktree resource, so this is the sanctioned use of an absolute path to the main checkout; workers must not edit anything under it.
- `.env` is gitignored, so a worktree has no `.env`, and the source plan's 001 probe command `node --env-file=.env server.js` would error on the missing file. Mitigation (deviation): the 001 check starts the server WITHOUT `--env-file`, passing `PORT` and `DATA_DIR` inline. The bridge result route writes a file and needs no API keys or `CANON_FILE`, so the traversal probe runs correctly without `.env`.

Shared-file hazard (deviation from the source plan's per-worker row edit):

- The source plan has each wave-3 worker edit its own one-line status row in `plans/README.md`, which is the only shared file across the parallel units. To remove that contention entirely, workers own NO `plans/` file here; the ORCHESTRATOR is the sole writer of `plans/README.md` status rows and updates them at each gate. This eliminates the wave-3 shared-file merge risk by construction; a merge conflict at the wave-3 gate is therefore a scope violation, not something to quietly resolve.

Sanctioned drift by wave (from the source plan's Sequencing rules - workers PROCEED on these, they do not STOP):

- Wave 2 (002): 001's `safe()` guard in `dir()`/`trainerDir()` is sanctioned drift in `lib/store.js`.
- Wave 3 (004): 001+002's changes to `lib/store.js` are sanctioned; compare `create()` against the plan excerpt by symbol and proceed on a benign match.
- Wave 3 (005): `public/app.js` is untouched by waves 1-2, so its drift check should be clean; re-locate targets by symbol if it differs.
- Wave 4 (003): the worktree HEAD already carries 001+002+004+005; 001's `safe()`, 002's guarded `list`/`get` + atomic `save` + 404 routes, and 004's shared `slugify` in `create()` are all sanctioned. STOP only on a structural mismatch of `create()`, `nextNumber()`, or the evolve/alter route tails.

## 5. Pre-flight checklist

- [ ] Capability probe recorded: ringer present at `/Users/jjrdar/repos/ringer`; engines `codex`, `claude`, `claude-zai`, `opencode` read from `~/.config/ringer/config.toml`. Not degraded mode.
- [ ] Repo clean enough to branch. `git status` at compile time showed only untracked docs (`docs/reviews/2026-08-08-improve-fix-sequencing-batch-review.md`, this file); surface any tracked-file dirt to the human before wave 1.
- [ ] Integration branch `integration/improve-fix-loop` created off `main` (compile-time tip `ccbf53b`) and checked out in `/Users/jjrdar/create/pokemine`, so ringer cuts worktrees from it.
- [ ] Log/run-state: `run-state.json` at repo root, updated at every launch and gate; per-wave summaries in `docs/handoffs/`.
- [ ] Ringer engine `claude-zai` present and `~/.config/ringer/` configured; `run_name` is `improve-fix-sequencing` for ALL four waves.
- [ ] `workdir` `/tmp/improve-fix-sequencing` exists; `mkdir -p /tmp/improve-fix-sequencing/exports`.
- [ ] Node >=20.6 (compile host: v26.3.0); `node_modules` present in the main checkout with express + sharp (the symlink target).
- [ ] Baseline `npm test` green on `main` (confirmed at compile: fail 0).
- [ ] Ringside on the human's screen before the first run: from `/Users/jjrdar/repos/ringer`, `./ringer.py hud`.

## 6. Wave-loop procedure and gates

Same `run_name` (`improve-fix-sequencing`) across all four waves, so the run accumulates as one artifact.
Ringer's built-in single retry (default `max_attempts: 2`) IS the repair pass; do not add another. Keep the retry (do not set `max_attempts: 1`): the GLM claude-zai lane has a documented attempt-1 warm-up NO-OP under parallel spawn that the retry absorbs.

Per wave:

1. Launch. Lint then run the wave's manifest: from `/Users/jjrdar/repos/ringer`, `./ringer.py lint <wave>.json && ./ringer.py run <wave>.json --identity improve-fix-loop`.
2. Gate (orchestrator). Read the run JSON in `~/.ringer/runs/` (statuses, retries, durations). For every retried or failed task read the raw worker log in `/tmp/improve-fix-sequencing/logs/` before deciding anything. Spot-check at least one passing artifact. On a FAIL, attribute before relaunching: re-run the check's steps yourself against the worktree tree; if the worker's output was correct and the CHECK was wrong (for example an unsatisfiable grep), fix the check, apply the audited patch, and annotate MODEL-NOTES instead of burning a round. The run JSON is truth; a background shell's exit status is transport.
3. Apply and integrate. `git apply /tmp/improve-fix-sequencing/exports/<key>.patch` on the integration branch (both patches for wave 3), commit with a plain conventional-commit message and NO agent co-author line, then update the unit's `plans/README.md` status row (orchestrator is the sole writer), and run the FULL `npm test` on the integration branch. Advance only on green.
4. Distill (P10). Turn any repeated failure pattern from this wave's verdicts into a fix in the relevant `plans/00N-*.md` and the spec/check before the next wave. Leave a dated MODEL-NOTES receipt for glm-5.2 in `/Users/jjrdar/repos/ringer/docs/MODEL-NOTES.md` (one line per task_type this wave, plus a line for any signal event: a check-bug attribution, a retry, an off-nominal result), supported only by the executed checks and raw logs. Commit that ringer-repo receipt BEFORE advancing the wave, so git-is-truth reconciliation covers both repos.

Ask-the-human list (the orchestrator STOPS and asks):

- Pre-flight dirty tree: any tracked-file uncommitted change before wave 1.
- Any request to exceed the effort cap of `high`.
- A spec/check edit that touches more than one unit, a global constraint, or a unit's produced contract (a single-unit clarification touching 15 or fewer lines auto-takes as BATCH and is applied to that `plans/00N-*.md`).
- Any outward-facing action: pushing a branch, opening a PR, or merging the integration branch to `main`. Workers never push; the final merge to `main` is the human's to fire.

Slip rule: a design-issue STOP (not a small spec bug) is recorded for the plan's downstream review step under the source plan's sanctioned-drift rules, not silently patched.

Final-wave advisory review: after wave 4's integration branch is green and the run advances, run `/loop-review ccbf53b` from the integration branch so the two-axis Spec-and-Standards report judges the whole-run diff. This is advisory and non-blocking (the per-unit checks already gated correctness); its findings are recorded at the final human checkpoint, and any Spec-axis finding slips to the downstream review step under the same slip rule. The final human checkpoint also confirms GitHub issues #12 (bridge CORS/PNA) and #13 (Gemini parts dedup) remain tracked as the knowingly-deferred threads.

## 7. Quota and resume

The orchestrator is the loop; if this session dies (quota, crash) the loop stops, so the run must die safely at any moment.
Each wave is its own rollback and resume unit: on interruption, relaunch the incomplete wave from scratch rather than resuming a half-applied plan (workers are stateless and ringer worktrees are ephemeral).

Durable state: `run-state.json` at the repo root records, per unit, its wave, launch/gate status, the exported patch path, and whether it is applied-and-tested on the integration branch. It is updated at every launch and every gate.

Reconciliation (trust git over the state file):

1. Read `run-state.json`, then the real git state: `git log --oneline` on `integration/improve-fix-loop` and the diff vs `main`.
2. Any unit not confirmed applied-and-tested on the integration branch is relaunched (never resumed) as a fresh ringer run under the same `run_name`.
3. Check the ringer repo for an uncommitted MODEL-NOTES receipt owed by the last gate: `git -C /Users/jjrdar/repos/ringer status`. If the last wave gated but its receipt is uncommitted, commit it before advancing (the run drives two repos; both are checkpointed).
4. Confirm the integration branch is checked out as HEAD in `/Users/jjrdar/create/pokemine` before launching the next wave, so ringer cuts worktrees from the right tip.

Verbatim resume prompt:

> Resume the improve-fix sequencing loop from `docs/plans/2026-08-08-improve-fix-sequencing-plan_loop.md`.
> Read `run-state.json` and the real git state of `integration/improve-fix-loop` (its log and its diff vs `main`).
> Trust git over the state file.
> Relaunch any wave whose unit is not confirmed applied-and-tested on the integration branch, as a fresh ringer run under `run_name` `improve-fix-sequencing`.
> Check `git -C /Users/jjrdar/repos/ringer status` for an uncommitted MODEL-NOTES receipt owed by the last gate and commit it first.
> Confirm the integration branch is checked out as HEAD in the pokemine repo, then continue the wave loop from Section 6.

## 8. Manifest task templates (one manifest per wave, same run_name)

All specs open with the worktree boundary and the two setup lines because the worker gets no conversation.
`{main}` is `/Users/jjrdar/create/pokemine` throughout.

### Wave 1 manifest (`wave1.json`)

```json
{
  "run_name": "improve-fix-sequencing",
  "workdir": "/tmp/improve-fix-sequencing",
  "repo": "/Users/jjrdar/create/pokemine",
  "worktrees": true,
  "max_parallel": 1,
  "tasks": [
    {
      "key": "001-traversal",
      "task_type": "code-fix",
      "engine": "claude-zai",
      "model": "glm-5.2",
      "spec": "You are a code-fix implementer. Your current working directory IS an isolated git worktree of the pokemine repo, detached at HEAD. Edit files here using paths relative to this worktree. NEVER touch the main checkout at /Users/jjrdar/create/pokemine (that absolute path is ONLY the shared node_modules). Do NOT git commit, do NOT push, do NOT open a PR: leave your changes uncommitted, the harness exports them.\n\nSETUP (run first): this worktree has no node_modules (gitignored). Run: ln -s /Users/jjrdar/create/pokemine/node_modules node_modules  (shared deps, never edit them). There is also no .env here (gitignored); do not create one.\n\nTASK: read plans/001-path-traversal-guard.md in this worktree and execute it end to end. In short: add `const SAFE_ID = /^[a-z0-9-]+$/` and a `safe(id)` helper near slugify in lib/store.js, and apply `safe()` inside the two path-builder chokepoints `dir()` and `trainerDir()` so every caller inherits path-safety (do NOT sprinkle safe() at each call site). Guard the two bridge write routes in server.js (the /result and /error handlers) with the same regex, returning res.status(400).json({error:'bad job id'}) on a non-matching req.params.id. Add the two regression tests from the plan to test/pokemine.test.js (a `store: rejects traversal ids` test and a `store: accepts normal slug ids` test).\n\nOWNERSHIP (edit ONLY these): lib/store.js, server.js, test/pokemine.test.js. Do NOT touch the CORS/Private-Network headers, the id/slug generation format, plans/README.md, or any other file.\n\nHOW TO RUN: npm test (full suite must exit 0). To verify the bridge guard yourself, start the server WITHOUT --env-file (there is no .env here): PORT=3399 DATA_DIR=$(mktemp -d) node server.js & then POST a traversal id (expect 400) and a normal id (expect 200) to /api/bridge/jobs/:id/result; kill the server after.\n\nAUTONOMY: if anything is ambiguous, take the most conservative reading, note it in your worker summary, and continue; do not stop to ask. If the plan's Current-state excerpts do not match the live code, note the mismatch and proceed only if the target functions are clearly present by symbol.\n\nOUTPUT: the three edited files, left uncommitted.",
      "expect_files": ["/tmp/improve-fix-sequencing/exports/001-traversal.patch"],
      "check": "REPO=/Users/jjrdar/create/pokemine; EXP=/tmp/improve-fix-sequencing/exports; mkdir -p \"$EXP\"; test -e node_modules || ln -s \"$REPO/node_modules\" node_modules; npm test >/tmp/001-test.log 2>&1 || { echo 'FAIL: npm test did not exit 0'; tail -20 /tmp/001-test.log; exit 1; }; grep -q 'safe(' lib/store.js || { echo 'FAIL: no safe() guard in dir()/trainerDir()'; exit 1; }; grep -q 'rejects traversal ids' test/pokemine.test.js || { echo 'FAIL: traversal regression test missing'; exit 1; }; D=$(mktemp -d); PORT=3399 DATA_DIR=\"$D\" node server.js >/tmp/001-srv.log 2>&1 & SRV=$!; sleep 2; ESC=$(curl -s -o /dev/null -w '%{http_code}' -X POST 'http://localhost:3399/api/bridge/jobs/..%2f..%2f..%2ftmp%2fpm-ESCAPE/result' -H 'Content-Type: application/json' -d '{\"b64\":\"aGk=\",\"mime\":\"image/png\"}'); OK=$(curl -s -o /dev/null -w '%{http_code}' -X POST 'http://localhost:3399/api/bridge/jobs/normalid/result' -H 'Content-Type: application/json' -d '{\"b64\":\"aGk=\",\"mime\":\"image/png\"}'); kill $SRV 2>/dev/null; rm -rf \"$D\"; [ \"$ESC\" = '400' ] || { echo \"FAIL: traversal id returned $ESC, expected 400\"; exit 1; }; if [ -e /tmp/pm-ESCAPE.png ]; then echo 'FAIL: LEAKED - file written outside DATA_DIR'; rm -f /tmp/pm-ESCAPE.png; exit 1; fi; [ \"$OK\" = '200' ] || { echo \"FAIL: normal id returned $OK, expected 200\"; exit 1; }; git add -A && git diff --cached > \"$EXP/001-traversal.patch\"; test -s \"$EXP/001-traversal.patch\" || { echo 'FAIL: exported patch is empty'; exit 1; }; echo 'OK: traversal contained (400/contained/200), safe() guard + test present, npm test green, patch exported'",
      "verified": "npm test is green, lib/store.js routes dir()/trainerDir() through safe(), a live server rejects a traversal bridge id with 400 while writing nothing outside DATA_DIR and accepts a normal id with 200, the regression test exists, and the worker's edits are exported as a patch."
    }
  ]
}
```

### Wave 2 manifest (`wave2.json`)

```json
{
  "run_name": "improve-fix-sequencing",
  "workdir": "/tmp/improve-fix-sequencing",
  "repo": "/Users/jjrdar/create/pokemine",
  "worktrees": true,
  "max_parallel": 1,
  "tasks": [
    {
      "key": "002-resilience",
      "task_type": "code-fix",
      "engine": "claude-zai",
      "model": "glm-5.2",
      "spec": "You are a code-fix implementer. Your cwd IS an isolated git worktree of the pokemine repo, detached at HEAD (it already carries the 001 path-traversal guard). Edit files here with relative paths. NEVER touch the main checkout at /Users/jjrdar/create/pokemine (only the shared node_modules). Do NOT commit, push, or open a PR: leave changes uncommitted.\n\nSETUP (run first): ln -s /Users/jjrdar/create/pokemine/node_modules node_modules  (no node_modules in a worktree; never edit them).\n\nSANCTIONED DRIFT: lib/store.js already differs from the plan's e0825c3 baseline by 001's safe() guard in dir()/trainerDir(); this is expected, PROCEED, do not STOP on it.\n\nTASK: read plans/002-store-drive-resilience.md in this worktree and execute it end to end. In short: (1) make list() and trainersList() wrap each per-record JSON.parse in try/catch, console.warn and drop failures (.filter(Boolean)) so one bad pokemon.json cannot brick a list or server startup; (2) make save() atomic (write to `${target}.tmp`, then fs.renameSync over the target); (3) make get() and trainerGet() return null on ENOENT (rethrow other errors), and have the routes that call them (GET /api/pokemon/:id, evolve, alter, patch, and the trainer routes) return res.status(404).json({error:'Not found'}) on null, with the 404 check placed BEFORE any SSE res.set(...text/event-stream...) headers. Add the three regression tests from the plan to test/pokemine.test.js (corrupt-record-skipped, get-returns-null, GET 404), mirroring the file's existing server-start/base pattern.\n\nOWNERSHIP (edit ONLY these): lib/store.js, server.js, test/pokemine.test.js. Do NOT touch saveArt/readArt binary paths, the global error handler beyond what the 404s need, plans/README.md, or the number-allocation logic (that is a later plan).\n\nHOW TO RUN: npm test (full suite must exit 0, including your 3 new tests).\n\nAUTONOMY: ambiguous -> conservative reading, note it, continue. If a new HTTP test cannot find a working server-start/base pattern in the file, mirror the nearest existing fetch-based test rather than standing up a bespoke harness.\n\nOUTPUT: the three edited files, left uncommitted.",
      "expect_files": ["/tmp/improve-fix-sequencing/exports/002-resilience.patch"],
      "check": "REPO=/Users/jjrdar/create/pokemine; EXP=/tmp/improve-fix-sequencing/exports; mkdir -p \"$EXP\"; test -e node_modules || ln -s \"$REPO/node_modules\" node_modules; npm test >/tmp/002-test.log 2>&1 || { echo 'FAIL: npm test did not exit 0'; tail -20 /tmp/002-test.log; exit 1; }; [ \"$(grep -c catch lib/store.js)\" -ge 4 ] || { echo 'FAIL: expected >=4 try/catch guards across list/get/trainersList/trainerGet'; exit 1; }; grep -q renameSync lib/store.js && grep -q '\\.tmp' lib/store.js || { echo 'FAIL: save() is not atomic (need a .tmp temp file + renameSync)'; exit 1; }; grep -q 404 server.js || { echo 'FAIL: no 404 missing-record guard in server.js'; exit 1; }; grep -q 'skips a corrupt record' test/pokemine.test.js || { echo 'FAIL: corrupt-record-skipped test missing'; exit 1; }; grep -q '404 for missing id' test/pokemine.test.js || { echo 'FAIL: GET-404 test missing'; exit 1; }; git add -A && git diff --cached > \"$EXP/002-resilience.patch\"; test -s \"$EXP/002-resilience.patch\" || { echo 'FAIL: exported patch is empty'; exit 1; }; echo 'OK: guards + atomic save + 404 present, 3 tests present, npm test green, patch exported'",
      "verified": "npm test is green with the corrupt-record-skipped, get-null, and GET-404 tests; lib/store.js has try/catch guards in the four readers and an atomic renameSync save(); server.js returns 404 on missing records; the edits are exported as a patch."
    }
  ]
}
```

### Wave 3 manifest (`wave3.json`) - two parallel, disjoint-file units

```json
{
  "run_name": "improve-fix-sequencing",
  "workdir": "/tmp/improve-fix-sequencing",
  "repo": "/Users/jjrdar/create/pokemine",
  "worktrees": true,
  "max_parallel": 2,
  "tasks": [
    {
      "key": "004-cleanup",
      "task_type": "code-fix",
      "engine": "claude-zai",
      "model": "glm-5.2",
      "spec": "You are a code-fix implementer. Your cwd IS an isolated git worktree of the pokemine repo, detached at HEAD (it already carries 001 and 002). Edit with relative paths. NEVER touch the main checkout at /Users/jjrdar/create/pokemine (only the shared node_modules). Do NOT commit, push, or open a PR: leave changes uncommitted. A sibling worker is concurrently editing public/* and test/card-format.test.js; you must not touch any file outside your ownership list.\n\nSETUP (run first): ln -s /Users/jjrdar/create/pokemine/node_modules node_modules  (never edit them).\n\nSANCTIONED DRIFT: lib/store.js already differs from the plan's e0825c3 baseline by 001+002; compare create() against the plan excerpt by SYMBOL and PROCEED on a benign match.\n\nTASK: read plans/004-cleanup-deadcode-and-readme.md and execute Steps 1-3 (Step 4 is OPTIONAL and gated: do it ONLY if it stays confined to the three named Gemini parts-extraction sites and all tests stay green, else SKIP and note it). In short: (1) delete the dead `const URL = '...gemini-flash-latest...'` line in lib/text.js (confirm it is unused first); (2) in lib/store.js create(), replace the inlined lowercase/replace slug chain with the existing shared helper: `const slug = slugify(record.stages[0].name) || 'pokemon';` (byte-identical output, pure dedup); (3) in README.md 'Setup (once)', add a CANON_FILE line and a TEXT_PROVIDER line plus a pointer to .env.example, house style (plain '-', one sentence per line).\n\nOWNERSHIP (edit ONLY these): lib/text.js, lib/store.js, README.md, and (only if you do the optional Step 4) lib/text-providers.js, lib/providers.js. Do NOT touch plans/README.md, public/*, test/*, or the provider-registry structure.\n\nHOW TO RUN: npm test (full suite must exit 0; slug output is unchanged, so the round-trip test still passes).\n\nAUTONOMY: ambiguous -> conservative reading, note it, continue. If optional Step 4 spreads beyond the three named sites, revert it and record 'DEBT-02 deferred'.\n\nOUTPUT: the edited files (lib/text.js, lib/store.js, README.md at minimum), left uncommitted.",
      "expect_files": ["/tmp/improve-fix-sequencing/exports/004-cleanup.patch"],
      "check": "REPO=/Users/jjrdar/create/pokemine; EXP=/tmp/improve-fix-sequencing/exports; mkdir -p \"$EXP\"; test -e node_modules || ln -s \"$REPO/node_modules\" node_modules; npm test >/tmp/004-test.log 2>&1 || { echo 'FAIL: npm test did not exit 0'; tail -20 /tmp/004-test.log; exit 1; }; if grep -q 'gemini-flash-latest' lib/text.js; then echo 'FAIL: dead URL const still present in lib/text.js'; exit 1; fi; [ \"$(grep -cF '[^a-z0-9]' lib/store.js)\" -le 1 ] || { echo 'FAIL: inline slugify chain still in create() (only the slugify definition should remain)'; exit 1; }; grep -q CANON_FILE README.md || { echo 'FAIL: README.md does not document CANON_FILE'; exit 1; }; git add -A && git diff --cached > \"$EXP/004-cleanup.patch\"; test -s \"$EXP/004-cleanup.patch\" || { echo 'FAIL: exported patch is empty'; exit 1; }; echo 'OK: dead const gone, slugify deduped, README documents CANON_FILE, npm test green, patch exported'",
      "verified": "npm test is green, the dead gemini-flash-latest URL const is gone from lib/text.js, create() no longer inlines the slug chain (only the slugify definition remains), README.md documents CANON_FILE, and the edits are exported as a patch."
    },
    {
      "key": "005-extract",
      "task_type": "code-feature",
      "engine": "claude-zai",
      "model": "glm-5.2",
      "spec": "You are a code-feature implementer. Your cwd IS an isolated git worktree of the pokemine repo, detached at HEAD (it already carries 001 and 002). Edit with relative paths. NEVER touch the main checkout at /Users/jjrdar/create/pokemine (only the shared node_modules). Do NOT commit, push, or open a PR: leave changes uncommitted. A sibling worker is concurrently editing lib/* and README.md; you must not touch any file outside your ownership list.\n\nSETUP (run first): ln -s /Users/jjrdar/create/pokemine/node_modules node_modules  (never edit them).\n\nTASK: read plans/005-extract-app-logic-tests.md and execute it. In short: create public/card-format.js holding the pure DOM-free helpers currently inline in public/app.js (esc, friendlyDate, PROVIDER_LABELS + providerLabel, VARIANT_LABELS, BALLS), copied VERBATIM (byte-identical logic), ending with the SAME dual-export shim as public/friendly-errors.js (module.exports for node, window assignment for the browser). In public/index.html add `<script src=\\\"/card-format.js\\\"></script>` BEFORE the app.js script tag. In public/app.js delete the now-moved definitions (they are globals, so bare-name calls keep working; ensure no `const esc =` remains). Add test/card-format.test.js mirroring test/friendly-errors.test.js (esc incl. null/undefined, providerLabel known+passthrough, VARIANT_LABELS keys, friendlyDate returns a string). Step 2 (extract the stageLabel string builder) is OPTIONAL: do it only if it separates cleanly from the DOM strings, else SKIP and note it.\n\nOWNERSHIP (create/edit ONLY these): public/card-format.js (new), public/app.js, public/index.html, test/card-format.test.js (new). Do NOT touch friendly-errors.js, loading-messages.js, the alert() paths, lib/*, README.md, or plans/README.md.\n\nHOW TO RUN: npm test (full suite must exit 0, including your new card-format tests). Sanity: node -e \\\"require('./public/card-format')\\\" must not throw.\n\nAUTONOMY: ambiguous -> conservative reading, note it, continue. Extraction must be behavior-preserving; do not 'improve' the copied helpers.\n\nOUTPUT: the four files (card-format.js, app.js, index.html, card-format.test.js), left uncommitted.",
      "expect_files": ["/tmp/improve-fix-sequencing/exports/005-extract.patch"],
      "check": "REPO=/Users/jjrdar/create/pokemine; EXP=/tmp/improve-fix-sequencing/exports; mkdir -p \"$EXP\"; test -e node_modules || ln -s \"$REPO/node_modules\" node_modules; npm test >/tmp/005-test.log 2>&1 || { echo 'FAIL: npm test did not exit 0'; tail -20 /tmp/005-test.log; exit 1; }; test -f public/card-format.js || { echo 'FAIL: public/card-format.js was not created'; exit 1; }; grep -q 'module.exports' public/card-format.js || { echo 'FAIL: card-format.js missing the dual-export shim'; exit 1; }; if grep -q 'const esc =' public/app.js; then echo 'FAIL: esc still defined in public/app.js (not moved out)'; exit 1; fi; grep -q 'card-format.js' public/index.html || { echo 'FAIL: card-format.js script not added to index.html'; exit 1; }; awk '/card-format.js/{c=NR} /app.js/{a=NR} END{exit !(c && a && c<a)}' public/index.html || { echo 'FAIL: card-format.js script is not before app.js'; exit 1; }; grep -q 'esc escapes HTML' test/card-format.test.js || { echo 'FAIL: card-format tests missing'; exit 1; }; git add -A && git diff --cached > \"$EXP/005-extract.patch\"; test -s \"$EXP/005-extract.patch\" || { echo 'FAIL: exported patch is empty'; exit 1; }; echo 'OK: card-format.js created with shim, esc moved out of app.js, script ordered before app.js, tests present, npm test green, patch exported'",
      "verified": "npm test is green with the new card-format tests, public/card-format.js exists with the dual-export shim, esc is gone from public/app.js, index.html loads card-format.js before app.js, and the edits are exported as a patch."
    }
  ]
}
```

### Wave 4 manifest (`wave4.json`)

```json
{
  "run_name": "improve-fix-sequencing",
  "workdir": "/tmp/improve-fix-sequencing",
  "repo": "/Users/jjrdar/create/pokemine",
  "worktrees": true,
  "max_parallel": 1,
  "tasks": [
    {
      "key": "003-integrity",
      "task_type": "code-fix",
      "engine": "claude-zai",
      "model": "glm-5.2",
      "spec": "You are a code-fix implementer. Your cwd IS an isolated git worktree of the pokemine repo, detached at HEAD; it ALREADY carries 001, 002, 004, and 005. Edit with relative paths. NEVER touch the main checkout at /Users/jjrdar/create/pokemine (only the shared node_modules). Do NOT commit, push, or open a PR: leave changes uncommitted.\n\nSETUP (run first): ln -s /Users/jjrdar/create/pokemine/node_modules node_modules  (never edit them).\n\nSANCTIONED DRIFT: your HEAD includes 001's safe() guard, 002's guarded list()/get() + atomic save() + 404 routes, and 004's shared slugify() inside create(). These are EXPECTED, PROCEED. Locate create(), nextNumber(), and the evolve/alter route tails by SYMBOL (line numbers shifted). STOP only if those functions differ STRUCTURALLY from the plan's post-wave 'Current state' excerpts.\n\nTASK: read plans/003-serialize-number-allocation.md and execute it. This closes two integrity hazards (GitHub #14); it does NOT add a mutex and does NOT convert create()/save() to async. In short: (1) add a persisted monotonic counter to lib/store.js - countersPath in init() (`<DATA_DIR>/counters.json`), initCounters() seeded from the current max AFTER migrateNumbers() and never lowered, bumpCounter(key) that reads-increments-writes atomically (temp + renameSync) and throws loudly if the counter file is unreadable, plus allocDex()/allocCollector(); export allocCollector, keep nextNumber exported and unchanged; (2) route create()'s two allocations through allocDex()/allocCollector() instead of list(); (3) evolve route: AFTER the image await, re-read the record fresh (store.get), re-check the fully-evolved invariant, push the new stage with number: store.allocCollector() to the FRESH copy, then save - with NO await between re-read and save; (4) alter route: AFTER the image await, re-read fresh and apply the art+description mutation to the fresh copy, then save. Add the two regression tests from the plan to test/pokemine.test.js.\n\nTEETH (required): write the two tests FIRST and confirm BOTH FAIL before the fix - run `node --test test/pokemine.test.js 2>&1 | grep -E '^not ok'` and verify both new tests appear. Then apply the fix and confirm npm test is fully green. Record in your worker summary that you confirmed the teeth.\n\nOWNERSHIP (edit ONLY these): lib/store.js, server.js, test/pokemine.test.js. Do NOT redo 001/002/004 work, do NOT add a file-lock library or any dependency, do NOT introduce withLock or make create() async, do NOT touch plans/README.md.\n\nHOW TO RUN: npm test (full suite must exit 0, including the 2 new tests).\n\nAUTONOMY: ambiguous -> conservative reading, note it, continue. If either new test does NOT fail before the fix, STOP and report (a toothless test was the original 003's fatal flaw).\n\nOUTPUT: the three edited files, left uncommitted.",
      "expect_files": ["/tmp/improve-fix-sequencing/exports/003-integrity.patch"],
      "check": "REPO=/Users/jjrdar/create/pokemine; EXP=/tmp/improve-fix-sequencing/exports; mkdir -p \"$EXP\"; test -e node_modules || ln -s \"$REPO/node_modules\" node_modules; npm test >/tmp/003-test.log 2>&1 || { echo 'FAIL: npm test did not exit 0'; tail -20 /tmp/003-test.log; exit 1; }; grep -Eq 'allocCollector|bumpCounter|initCounters' lib/store.js || { echo 'FAIL: persisted counter not wired into lib/store.js'; exit 1; }; grep -q allocCollector server.js || { echo 'FAIL: evolve route does not allocate the stage number via the counter'; exit 1; }; if grep -Eq 'withLock|await store.create' lib/store.js server.js; then echo 'FAIL: forbidden mutex/withLock or async create() introduced'; exit 1; fi; grep -q 'concurrent evolves do not lose an update' test/pokemine.test.js || { echo 'FAIL: concurrent-evolve lost-update test missing'; exit 1; }; grep -q 'not reused when a record is transiently unreadable' test/pokemine.test.js || { echo 'FAIL: counter-not-reused test missing'; exit 1; }; git add -A && git diff --cached > \"$EXP/003-integrity.patch\"; test -s \"$EXP/003-integrity.patch\" || { echo 'FAIL: exported patch is empty'; exit 1; }; echo 'OK: counter wired + exported, evolve allocs via counter, no mutex/async ripple, both teeth tests present, npm test green, patch exported'",
      "verified": "npm test is green with the concurrent-evolve and transiently-unreadable tests, lib/store.js has the persisted counter wired into create() and exports allocCollector, the evolve route re-reads and allocates via the counter, no mutex or async-create was introduced, and the edits are exported as a patch."
    }
  ]
}
```

## 9. Kicking it off

The human says: "Run the improve-fix loop, wave 1."
The orchestrator runs the Section 5 pre-flight (create and check out `integration/improve-fix-loop`, put Ringside on screen), then from `/Users/jjrdar/repos/ringer` runs `./ringer.py lint wave1.json && ./ringer.py run wave1.json --identity improve-fix-loop`, and drives the Section 6 wave loop through waves 2, 3, and 4.
Per-wave summaries land in `docs/handoffs/`, and the MODEL-NOTES receipt for glm-5.2 lands in `/Users/jjrdar/repos/ringer/docs/MODEL-NOTES.md` at each gate.
Watch the run live: `tail -f /tmp/improve-fix-sequencing/logs/*` during a wave, the Ringside page at http://127.0.0.1:8700, and the run JSON in `~/.ringer/runs/` at each gate; `run-state.json` at the repo root is the durable checkpoint.
Watch points: the GLM claude-zai attempt-1 warm-up NO-OP under wave-3 parallel spawn (the retry absorbs it - do not panic on a first-attempt empty diff); the wave-3 gate must apply two disjoint patches with no conflict (a conflict is a scope violation); and the final merge of the integration branch to `main` is the human's to fire, never the loop's.
If interrupted, use the verbatim resume prompt in Section 7.
