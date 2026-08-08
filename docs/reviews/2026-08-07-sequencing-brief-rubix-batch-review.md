# Batch review: sequencing-brief Rubix run (2026-08-07)

Gate journal for the autonomy run started after `/loop-auto set auto`.
ASK/STOP entries are record-only (resolved live); BATCH/DEFAULT entries are the review obligation - accept or reverse each.

## 1. ASK - persist autonomy default (record-only)

- Decision: asked whether to commit `autonomy-default: auto` to `config/repo-state.md`; human chose session-only.
- Rationale: first `set` in this repo triggers the persist question per the loop-auto protocol.
- Reversal: n/a - resolved live.

## 2. DEFAULT - commit the revised sequencing brief

- Decision: committed `docs/briefs/2026-08-07-improve-plan-sequencing-brief.md` (Rubix findings 1-5, 7-10 incorporated) as `76c3cc3`.
- Rationale: the commit was offered pre-auto and left standing when the human flipped auto; the brief was already a tracked doc, and the revision set was explicitly approved finding-by-finding.
- Reversal: `git revert 76c3cc3`.

## 3. DEFAULT - file the tracker issues the revised brief mandates

- Decision: opened three GitHub issues per the brief's tracker note and follow-up instructions:
  - #12 Bridge CORS/PNA hardening (bug) - the medium content-safety residual 001 leaves open.
  - #13 DEBT-02 Gemini parts-extraction dedup (idea).
  - #14 Number-integrity follow-up: lossy `list()` duplicate + concurrent-evolve lost update (bug).
- Rationale: the accepted finding #8 wrote "open a GitHub issue for each before closing the brief" into the brief itself; the Seams section says "track as a follow-up" for the number-integrity ceiling, and GitHub is the source of record per `config/repo-state.md`.
- Reversal: `gh issue close 12 13 14` (or edit/relabel individually).

## 4. ASK - plan 003 scope (record-only, 2026-08-08)

- Decision: asked how 003 enters the sequencing plan; human chose re-scope to the issue #14 hazards (evolve lost-update, lossy-list number reuse).
- Rationale: the brief's open question; a planning judgment, never auto-takeable.
- Reversal: n/a - resolved live.

## 5. DEFAULT - draft dispatch and no second Rubix pass

- Decision: dispatched one Opus plan-draft worker to rewrite plans/003 and write docs/plans/2026-08-08-improve-fix-sequencing-plan.md; skipped re-running the Rubix review on the resulting plan.
- Rationale: the plan-draft role pin resolves to Opus per the loop-plan protocol; the Rubix findings were produced this run and are baked into the drafting instructions, so a second two-lens pass would re-review its own output.
- Reversal: cheap - request the Rubix pass on the finished plan and it runs as usual.

## Open decisions

None remaining.
The 003 re-scope question was resolved live at entry 4 (re-scope to the issue #14 hazards).
