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
- Wave 3: plans 004 and 005 in parallel - independent, no urgency, no shared files.
- Wave 4: plan 003 last - kept per decision but de-prioritized; still requires 002 first, and isolating it contains the async-`create()` blast radius.

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

## Known vs guessed

- Verified: the 001 exploit was reproduced live (a file written outside DATA_DIR); the 003 race mechanism was read directly in the code; the 48/48 test baseline was run this session.
- Believed-unchecked: 002's Drive-corruption frequency - plausible from "DATA_DIR is Drive-synced" but not measured. If corruption never actually happens, 002 is cheap insurance rather than an active fix.
- Guessed: concurrent generation is rare at 1-2 siblings. If wrong (more kids, or shared sessions), 003 rises in priority.

## Parking lot

- Bridge CORS/PNA hardening: restrict `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Private-Network: true` on the `/api/bridge` routes. Deferred from 001, which closes traversal but leaves the headers open.
- DEBT-02 Gemini parts-extraction dedup: the same `candidates[0].content.parts` parse in three files. Gated as optional Step 4 inside plan 004; low urgency, shapes are stable.

## Out of scope

- New features: the battle/play mechanic layer, pokedex-book view, video-of-a-move.
- Everything in the `plans/README.md` considered-and-rejected list: PERF double-scan and cache-buster, GitHub Actions CI, ESLint/Prettier, jsdom/Playwright frontend E2E, and merging the two provider registries.

## Open questions for planning

- Should the bridge routes' `Access-Control-Allow-Origin: *` + `Allow-Private-Network: true` be restricted to the extension or localhost origin? Traversal is closed regardless; this is a separate, lower-risk investigation, not a blocker.
