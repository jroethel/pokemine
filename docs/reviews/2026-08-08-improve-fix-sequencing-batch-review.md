# Batch review - improve-fix sequencing loop run (2026-08-08)

Gate journal for the autonomous /loop-drive run of `docs/plans/2026-08-08-improve-fix-sequencing-plan.md`.
Mode: auto (session, `docs/chain-state.md`).
Entries are chronological; BATCH and DEFAULT entries are the review obligation, ASK and STOP are record-only.

## Entries

### 1. BATCH - Step 0 topology lean

- Decision: all-ringer transport, one manifest per wave, 4 sequential waves (wave 3 holds two parallel tasks); gates run patch-export -> integration branch -> full `npm test` -> MODEL-NOTES receipt.
- Rationale: ringer is present (engines codex, claude, claude-zai, opencode), so per loop-drive units take ringer unless they need in-session tools; none do. Scoreboard receipts and the flat-rate claude-zai lane preserve Anthropic quota. Alternate (Agent-tool workers) considered and not close.
- Reversal path: scoped re-run of any wave with Agent-tool transport if ringer misbehaves; the manifests remain valid input either way.

### 2. DEFAULT - pre-flight housekeeping: gitignore chain-state

- Decision: added `docs/chain-state.md` to `.gitignore` and committed the one-line change before wave 1, instead of firing the dirty-tree STOP.
- Rationale: `config/repo-state.md` already declares chain-state "Runtime, gitignored"; the ignore line was simply missing. Tracked tree was otherwise clean, so no real uncommitted work existed for a STOP to surface.
- Reversal path: `git revert` the one-line commit.

### 3. DEFAULT - pin review verdict and launch

- Decision: compiled `_loop.md` accepted at pin review; Step 7 execution-details question auto-took its default (launch immediately, dry-run checks executed as pre-flight).
- Rationale: routing table, hazards, gates, and resume machinery all conform to the skill; every check grep-string was verified verbatim against the plans (satisfiable under spec); `--identity` confirmed a real ringer flag. Noted non-blocking weakening: the wave-1 LEAKED probe path only matches a fixed `/tmp` DATA_DIR, but the 400-status check is the primary gate.
- Reversal path: n/a for the review itself; any launch is reversible by dropping the integration branch (`git branch -D integration/improve-fix-loop`).

### 4. DEFAULT - lint fix: expect_files point at exported patches

- Decision: ringer lint flagged all in-worktree `expect_files` (deliverables die with a passing worktree); repointed every task's `expect_files` at its exported patch in `/tmp/improve-fix-sequencing/exports/`, in all four manifests and the `_loop.md`.
- Rationale: Step 7 says fix what the dry run flags before launch; the checks already exported the patches, only the manifest field was wrong. All four manifests now lint clean.
- Reversal path: `git revert` the plan-file commit; regenerate manifests from the plan.

### 5. DEFAULT - wave 1 gate: pass, applied, one distill

- Decision: 001-traversal PASS attempt 1 (run `improve-fix-sequencing-20260808T130401Z-p25113`); patch applied to the integration branch with `--exclude=node_modules`; integrated `npm test` 50 pass / 0 fail; live traversal probe re-derived by the orchestrator (400 / contained / 200). Distill: the patch-export line in the three remaining checks (and the plan) now unstages the `node_modules` symlink before diffing, fixing the patch-pollution my original check design caused.
- Rationale: the worker's setup symlink was staged by the check's `git add -A`; excluding it at apply time and at export time is mechanical hygiene, not a change to any unit's produced contract. Worker also flagged that `safe()` makes `list()` throw on stray non-slug entries (e.g. `.DS_Store`); accepted as the plan's deliberate chokepoint choice (wave 2 does NOT resolve it - its guard sits inside `list()`'s map, while the `existsSync` filter still routes through `safe()`; this stays known, accepted behavior per plan 001's maintenance notes).
- Reversal path: `git revert` the wave-1 integration commit.

### 6. DEFAULT - wave 2 gate: pass, applied

- Decision: 002-resilience PASS attempt 1 (run `...T130912Z-p28622`); clean patch (no pollution) applied; integrated `npm test` 53 pass / 0 fail; check greps re-derived on the integrated tree (4 catch guards, atomic `renameSync` save at store.js:81, five 404 guards). No distill needed this wave.
- Rationale: substance matches the store contract downstream waves consume (lossy `list()`, atomic `save()`, ENOENT-null + 404s before SSE headers); the three regression tests match the plan's names.
- Reversal path: `git revert` the wave-2 integration commit.

### 7. DEFAULT - wave 3 gate: both parallel units pass, applied

- Decision: 004-cleanup and 005-extract both PASS attempt 1 (run `...T131252Z-p30715`, `max_parallel: 2`, no warm-up NO-OP); patches disjoint exactly per ownership (no conflict); both applied; integrated `npm test` 59 pass / 0 fail; `card-format.js` loads clean under node. 005 took its optional `stageLabel` extraction (spec-sanctioned when it separates cleanly); 004 skipped its optional Step 4 (Gemini dedup stays GitHub #13).
- Rationale: 004 is byte-identical dedup plus README env docs; 005 is verbatim extraction with the dual-export shim and correct script order. The orchestrator-as-sole-writer protocol for `plans/README.md` held (both workers explicitly deferred the row edit).
- Reversal path: `git revert` the wave-3 integration commit.

### 8. DEFAULT - wave 4 gate: pass, applied, teeth verified

- Decision: 003-integrity PASS attempt 1 (run `...T131827Z-p33627`); teeth verified in the RAW worker log (both new tests failed pre-fix with the predicted failures: lost update `2 == 3`, dex reuse `17 must exceed 17`); patch applied; integrated `npm test` 61 pass / 0 fail; no-mutex/no-async grep empty on the integrated tree.
- Rationale: counter design matches the produced contract (`counters.json` under DATA_DIR, atomic bump, loud throw on unreadable, present-but-unreadable file protected from reset); evolve/alter re-read after the await with no await before save; the concurrent-evolve test forces the interleave with a real barrier. Worker's `^not ok` grep deviation (Node spec reporter emits `✖`) accepted as an honest, correct attribution.
- Reversal path: `git revert` the wave-4 integration commit.

### 9. BATCH - terminal loop-review findings and wave 5 remediation

- Decision: the advisory `/loop-review ccbf53b` Spec axis found one real defect, which the orchestrator CONFIRMED by live repro: a stray `.DS_Store` in a Drive-synced `DATA_DIR` threw inside `safe()` during `list()`'s scan and bricked server startup (001 introduced the throw path; 002's guard did not cover it; journal entry 5's "accepted behavior" call was wrong). Remediated as a one-task wave 5 (`006-stray-entry`, glm-5.2, PASS attempt 1): `SAFE_ID` pre-filter with skip-warn in the two directory scans only, `safe()` untouched for request-derived ids, plus a regression test; integrated `npm test` 62 pass / 0 fail and the repro now serves 200. Standards axis: zero hard violations, four Duplicated Code judgement calls left unfixed (atomic-write shape x2, collector-max reduce x2, SAFE_ID regex in two files, re-read block x2) - recorded, not acted on, per the slip rule. Scope-creep finding also taken: `run-state.json` untracked and gitignored (runtime state, like chain-state).
- Rationale: the defect is the exact corrupt-brick failure mode this run was chartered to close, on the environment (Drive-synced macOS) the README recommends; fixing it via a fresh checked worker keeps the orchestrator-never-implements rule while the merge to `main` stays the human's trigger. The Duplicated Code smells are taste-level refactors that belong in a deliberate pass, not an autonomous tail.
- Reversal path: `git revert` the wave-5 integration commit; the smells list lives in this entry for a future pass.
