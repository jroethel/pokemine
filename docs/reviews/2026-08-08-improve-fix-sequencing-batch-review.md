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
- Rationale: the worker's setup symlink was staged by the check's `git add -A`; excluding it at apply time and at export time is mechanical hygiene, not a change to any unit's produced contract. Worker also flagged that `safe()` makes `list()` throw on stray non-slug entries (e.g. `.DS_Store`); accepted as the plan's deliberate chokepoint choice, and wave 2's guarded `list()` skip-and-warn resolves it.
- Reversal path: `git revert` the wave-1 integration commit.
