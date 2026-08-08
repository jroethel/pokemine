# Brief: Sequencing the improve fix plans (001-005)

Date: 2026-08-07.
Subject: an execution strategy over the five vetted fix plans in `plans/`, written at commit `e0825c3`.
This brief sequences and scopes the plans; it does not re-specify them - each `plans/00N-*.md` is self-contained.

## Outcome

A hardened pokemine: the live arbitrary-file-write closed, and the Google Drive-synced store unable to corrupt-brick the app.
The named action ("brainstorm the plans") was really a request for an execution strategy over five already-vetted fix plans, not a new feature.
Presupposition verdict: confirmed - the plans exist and are sound; what was missing is order, scope calls, and the open threads, which this brief supplies.

## End artifact

Value ships the instant plan 001 lands, because it depends on nothing.
The full sequence yields a repo where `npm test` is green, a path-traversal probe is contained, and one corrupt `pokemon.json` no longer stops server startup.

## Done looks like

Every selected plan executed, with its own done-criteria passing.
The universal gate, from the repo root `/Users/jjrdar/create/pokemine`:

- `npm test` exits 0 (48 baseline tests plus the new tests each plan adds).
- Each plan's specific grep/probe gates pass (listed under Success criteria).
- After each wave merges to `main`, run the full `npm test` on integrated `main` (all five test files, not just the current plan's probe), so an earlier wave's regression into a later file is caught.
  A wave is not done until integrated `main` is green.

## Assets and options

| Asset                                             | Implied option                                          | Verdict                              |
| ---                                               | ---                                                    | ---                                  |
| Five plans written for the weakest executor       | Run via `/loop-drive`, `/improve execute`, or by hand   | Deferred - "brief only for now"      |
| 001 is Small, independent, and the only live vuln | Ship it alone, first                                    | Chosen                               |
| 001 and 002 both edit `store.js` + `server.js`, both P1 | Combine into one branch/PR                         | Declined - keep separate, sequential |
| 003 rewires `create()` to async (caller ripple)   | Fold into 002, or isolate it                            | Chosen: isolate, sequence last       |
| Bridge CORS/PNA headers left open by 001          | Add a sixth plan to tighten them                        | Declined - open question only        |

## Approach

Chosen: security-first waves, isolate the risky one.

- Wave 1: plan 001 alone - the only live vulnerability, Small, depends on nothing. Ship immediately.
- Wave 2: plan 002 - Drive-resilience; corruption is when-not-if on a Drive-synced DATA_DIR, and the startup-brick failure is severe.
- Wave 3: plans 004 and 005 in parallel - independent on code files, but both edit `plans/README.md` (their status row), so this is not "no shared files".
  Have each worker touch only its own one-line status row (distinct lines merge cleanly), or serialize the status-row edit as a single post-merge step done once after both land.
- Wave 4: plan 003 last - kept per decision but de-prioritized; still requires 002 first.
  See the reframe under "Known vs guessed": 003 hardens a duplicate-number race that does not exist in the current synchronous code, so treat it as defensive future-proofing, not a live-bug fix, and re-scope or defer it pending a test that actually fails without the lock.
  003 also edits `create()` in `lib/store.js`, which 004 rewrites in Wave 3, so run 004 before 003 (already the order) or expect a rebase in that function.

Resume and rollback: each wave is its own branch(es)/PR and is the rollback and resume unit.
On interruption (quota, crash), relaunch the incomplete wave from scratch rather than resuming a half-applied plan.

Alternatives considered:

- One branch for both P1s (001 + 002): rejected - would delay the security fix behind an M-sized plan for no real gain.
- Strict numeric order 001 through 005: rejected - buries the quick wins (004, 005) behind 003's caller ripple.

## Success criteria

All `[executed-check]` - every plan carries verification commands, so none is a judgment call.

- 001: the traversal probe prints `400`, `contained`, `200` in order; `npm test` green. `[executed-check]`
- 002: the corrupt-record-skipped test and the missing-id-returns-404 test pass. `[executed-check]`
- 004: greps for the dead `URL` const and the inline slugify return empty; README greps `CANON_FILE`. `[executed-check]`
- 005: `test/card-format.test.js` passes and no `const esc =` remains in `public/app.js`. `[executed-check]`
- 003: the 5-concurrent-create test yields all-distinct dex and collector numbers. `[executed-check]`

## Seams

The five plans are the seams, in blast-radius order:

1. 001 - path-traversal guard (security).
2. 002 - store Drive-resilience.
3. 004 - dead-code + README cleanup.
4. 005 - extract app.js pure logic for tests.
5. 003 - serialize number allocation (depends on 002).

001 and 002 touch the same two files but different lines; running them sequentially keeps the diffs clean.
003 is the only hard dependency (on 002).
003 and 004 both edit `create()`; 004 (Wave 3) lands first, so 003 rebases clean, but that ordering is load-bearing, not incidental.
Every post-Wave-1 plan drift-checks against commit `e0825c3`, yet each wave changes `lib/store.js` and `server.js`: after Wave 2 those files differ from `e0825c3` (001+002), and after Wave 3 `create()` uses the shared slugify (004).
These drifts are benign and sanctioned - an executor hitting a drift-check STOP on exactly these already-landed changes should proceed, not halt; re-anchor each plan's drift-check to the tip of the prior wave if running strictly.
Interaction risk (002 x number allocation): 002 makes `list()` silently skip unreadable records, and both `create()`'s dex number and `nextNumber()` derive from `list()`, so a record transiently unreadable mid Drive-sync can have its number reused, producing a duplicate when the file reappears.
Neither 002 nor 003 closes this; it is the real number-integrity ceiling of the "no duplicate numbers" outcome, and closing it needs allocation that does not derive from a lossy `list()` (e.g. a persisted monotonic counter).
Track as a follow-up.

## Known vs guessed

- Verified: the 001 exploit was reproduced live (a file written outside DATA_DIR); the 48/48 test baseline was run this session.
- Correction (previously mis-filed as Verified): the duplicate-number race 003 targets does not exist in the current code.
  In both `create()` (`lib/store.js:31-40`) and evolve (`server.js:271-276`) the number allocation and the `save()` are synchronous and contiguous with no `await` between them, and the image generation completes before that block runs, so Node's single thread serializes concurrent requests and each sees the other's saved record.
  003's withLock is therefore defensive against a future refactor that puts an `await` between allocate and save, not a fix for a live bug, and its "remove withLock and it fails" teeth-test will not fail against today's code.
- Believed-unchecked: 002's Drive-corruption frequency - plausible from "DATA_DIR is Drive-synced" but not measured. If corruption never actually happens, 002 is cheap insurance rather than an active fix.
- Guessed: concurrent generation is rare at 1-2 siblings. If wrong (more kids, or shared sessions), the exposure to prioritize is the concurrent-evolve lost update (see Open questions), not 003 as currently scoped.

## Parking lot

- Bridge CORS/PNA hardening: restrict `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Private-Network: true` on the `/api/bridge` routes (`server.js:57-64`). Deferred from 001, which closes traversal but leaves the headers open.
  Severity note: this is not a low-risk investigation.
  After 001, any page a family member visits can still read the child's typed prompts cross-origin (`GET /api/bridge/jobs`) and forge an image result (`POST /api/bridge/jobs/:id/result`) that injects an attacker-chosen picture into the child's card.
  That is a medium content-safety exposure for a kid-facing app; deferral is defensible, the "lower-risk" framing is not.
- DEBT-02 Gemini parts-extraction dedup: the same `candidates[0].content.parts` parse in three files. Gated as optional Step 4 inside plan 004; low urgency, shapes are stable.
- Tracker note: per `config/repo-state.md`, GitHub is the source of record, but these parking-lot threads live only in this dated brief.
  Open a GitHub issue for each (the CORS/PNA thread especially) before closing the brief, so the one security hole 001 knowingly leaves open survives outside this document.

## Out of scope

- New features: the battle/play mechanic layer, pokedex-book view, video-of-a-move.
- Everything in the `plans/README.md` considered-and-rejected list: PERF double-scan and cache-buster, GitHub Actions CI, ESLint/Prettier, jsdom/Playwright frontend E2E, and merging the two provider registries.

## Open questions for planning

- Should the bridge routes' `Access-Control-Allow-Origin: *` + `Allow-Private-Network: true` be restricted to the extension or localhost origin? Traversal is closed regardless; this is a separate investigation (see the severity note in Parking lot), not a blocker.
- Concurrent evolve on one record is a stale-read lost update: the route reads the record with `store.get()` before the multi-second image `await` (`server.js:240`), then pushes and saves its own now-stale copy (`server.js:271-276`), so a second concurrent evolve overwrites the first.
  003 wraps only allocate+save in withLock, so it does not address this.
  Decide whether to re-scope 003 to this real hazard (plus the 002-x-allocation duplicate under Seams) or track it separately.
