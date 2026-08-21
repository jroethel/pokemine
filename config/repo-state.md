# Repo State Map

This file is the machine surface: the line-anchored keys and the Lanes table that parsers read.
The tracker backend (github, gitlab, or local) is declared in the `tracker:` key below.
Mode-invariant doctrine lives in the sibling `config/conventions.md`.

template-version: 4

Remote: https://github.com/jroethel/pokemine.git

## Lanes

| Lane          | Home                      | How                                             |
| ---           | ---                       | ---                                             |
| Roadmap       | `ROADMAP.md`              | Living file; edit in place, no mirror.          |
| Issues        | GitHub (open, no `idea`)  | `ISSUES.md` via `scripts/gen-mirrors.sh .`.     |
| Backlog       | GitHub (label `idea`)     | `BACKLOG.md` via `scripts/gen-mirrors.sh .`.    |
| Handoffs      | `docs/handoffs/`          | Per session; git fallback in conventions.md.    |
| Chain state   | `docs/chain-state.md`     | Runtime, gitignored.                            |
| Batch reviews | `docs/reviews/`           | Per review run.                                 |
| Archive       | `docs/archive/`           | Moved work lands here.                          |

Backlog cross-repo view: `gh search issues --owner jroethel --label idea --state open`.
Per-repo fallback when private-repo search is unavailable: `gh issue list --label idea --state open`.

GitHub is the single source of truth.
Mirrors are read-only snapshots whose headers disclose staleness.
They regenerate at handoff time or on demand - no hooks, no daemons.
tracker: github
