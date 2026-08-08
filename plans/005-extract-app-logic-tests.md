# Plan 005: Extract public/app.js pure logic and unit-test it

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report - do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e0825c3..HEAD -- public/app.js`
> If it changed since this plan was written, re-locate the functions named below
> by symbol (not by line number) before editing; on a structural mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `e0825c3`, 2026-08-07

## Why this matters

`public/app.js` is 626 lines and the highest-churn frontend file, yet it has zero
automated coverage - `npm test` stays green while the UI silently regresses.
Full DOM testing is off the table (jsdom/Playwright are dependencies, and the repo
is deliberately zero-dep). But the repo already has the right pattern: pure logic
is pulled into small modules loaded BOTH as a browser global and via `require()`
for `node:test` (`public/friendly-errors.js`, `public/loading-messages.js`). This
plan applies that same pattern to the pure transforms still inline in `app.js`, so
the logic that shapes cards and labels gets real tests without any new dependency.
The DOM wiring stays untested by design.

## Current state

The exemplar to copy exactly - `public/friendly-errors.js` ends with the
dual-export shim that makes it both a browser global and a `node:test` module:

```js
if (typeof module !== 'undefined') module.exports = { friendlyError, RULES };
if (typeof window !== 'undefined') window.friendlyError = friendlyError;
```

And `test/friendly-errors.test.js` is the test pattern to mirror
(`require('../public/friendly-errors')`, plain `node:test` + `assert`).

Pure (DOM-free) transforms currently inline in `public/app.js` - these are the
extraction targets:

- `public/app.js:2` - `esc(s)` - HTML-escapes `& < > "`. Pure. Used everywhere.
- `public/app.js:141` - `friendlyDate(iso)` - formats an ISO date string. Pure.
- `public/app.js:171-177` - `PROVIDER_LABELS` + `providerLabel(p)` - maps a
  provider id to a display label. Pure.
- `public/app.js:219` - `VARIANT_LABELS` - the variant id -> label map. Pure data.
- `public/app.js:51` - `BALLS` array (phase -> pokeball name). Pure data.
- The stage-label logic in `cardHTML` (`public/app.js:221-234`): the "Stage N ·
  Evolves from X" / tier computation. Extract the string-building part that
  doesn't touch the DOM (see Step 2); leave the `document`/innerHTML parts in place.

Do NOT try to extract functions that read `localStorage`, `document`, `location`,
or `window` (e.g. `currentProvider`, `setPhase`, `showLoading`, `cardHTML`'s DOM
assembly) - those are the untestable DOM layer and stay in `app.js`.

## Commands you will need

| Purpose | Command      | Expected on success        |
|---------|--------------|----------------------------|
| Tests   | `npm test`   | all pass (48 today + new)  |

## Scope

**In scope**:
- `public/card-format.js` (create - new module for the extracted pure logic)
- `public/app.js` (remove the inlined copies; load the new module; keep DOM code)
- `public/index.html` (add a `<script>` for the new module BEFORE app.js)
- `test/card-format.test.js` (create)

**Out of scope**:
- Any DOM behavior change - extraction must be behavior-preserving; the page must
  render identically.
- `friendly-errors.js` / `loading-messages.js` - already extracted, leave them.
- The 3 legacy `alert()` paths (tracked separately as issue #1) - do not migrate
  them here.

## Git workflow

- Branch: `advisor/005-extract-app-logic-tests`
- Commit style: conventional commits, e.g.
  `test(ui): extract pure card-format logic and cover it`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create public/card-format.js with the pure helpers

Move `esc`, `friendlyDate`, `PROVIDER_LABELS` + `providerLabel`, `VARIANT_LABELS`,
and `BALLS` into a new `public/card-format.js`, ending with the same dual-export
shim as `friendly-errors.js`:

```js
// Pure formatting helpers for cards/labels. No DOM refs, so unit-testable in node.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
// ... friendlyDate, PROVIDER_LABELS, providerLabel, VARIANT_LABELS, BALLS ...

if (typeof module !== 'undefined') module.exports = { esc, friendlyDate, providerLabel, PROVIDER_LABELS, VARIANT_LABELS, BALLS };
if (typeof window !== 'undefined') Object.assign(window, { esc, friendlyDate, providerLabel, PROVIDER_LABELS, VARIANT_LABELS, BALLS });
```

Copy each function/const VERBATIM from `app.js` (byte-identical logic) - do not
"improve" them. Get the exact `esc` body from `public/app.js:2-4`.

### Step 2: Extract the stage-label string builder (optional but preferred)

If straightforward, pull the pure part of the stage label out of `cardHTML`
(`app.js:221-234`) into `card-format.js` as e.g.
`stageLabel(rec, idx)` returning the `"Basic"` / `"Stage N · Evolves from X"`
string (it already uses `esc`, which now lives in the same module). Leave all
`document`/template-HTML assembly in `cardHTML`. If the label logic is too
entangled with DOM strings to separate cleanly, SKIP this step and note it - Step 1
alone delivers the coverage win.

### Step 3: Load the module in app.js and index.html; remove the inlined copies

- In `public/index.html`, add `<script src="/card-format.js"></script>` BEFORE the
  `app.js` script tag (so the globals exist first) - mirror how `friendly-errors.js`
  / `loading-messages.js` are included.
- In `public/app.js`, delete the now-moved definitions. They are available as
  globals (the module assigns them to `window`), exactly like `window.friendlyError`
  is used at `app.js:40`. If `app.js` references them by bare name (`esc(...)`),
  that keeps working because they're globals; confirm no `const esc = ...` remains
  in `app.js` (a duplicate `const` would throw).

**Verify**:
```
grep -n "const esc =" public/app.js     # expected: no matches (moved out)
grep -n "card-format.js" public/index.html  # expected: one <script> match, before app.js
```

### Step 4: Write test/card-format.test.js

Mirror `test/friendly-errors.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { esc, friendlyDate, providerLabel, VARIANT_LABELS } = require('../public/card-format');

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<b>"x" & y</b>'), '&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('providerLabel maps known ids and passes through unknown', () => {
  // assert against the actual PROVIDER_LABELS entries you moved
});

test('VARIANT_LABELS covers the three variant tiers', () => {
  assert.deepEqual(Object.keys(VARIANT_LABELS).sort(), ['EX', 'Mega', 'VMAX']);
});

test('friendlyDate formats an ISO string without throwing', () => {
  assert.ok(typeof friendlyDate('2026-07-25T00:00:00.000Z') === 'string');
});
```

Fill the `providerLabel` assertions from the real mapping you moved.

**Verify**: `npm test` -> all pass, including the new `card-format` tests.

## Test plan

- New tests in `test/card-format.test.js`: `esc` (incl. null/undefined),
  `providerLabel` (known + passthrough), `VARIANT_LABELS` keys, `friendlyDate`
  returns a string. Modeled on `test/friendly-errors.test.js`.
- Behavior-preservation check: `npm test` green AND a manual page load renders a
  card identically (the executor may skip the manual check but must not change
  visible output).
- Verification: `npm test` -> all pass, ~4 new tests.

## Done criteria

ALL must hold:

- [ ] `npm test` exits 0; `test/card-format.test.js` exists with passing tests
- [ ] `public/card-format.js` exists and ends with the dual-export shim
- [ ] `grep -n "const esc =" public/app.js` -> no matches
- [ ] `grep -n "card-format.js" public/index.html` -> one match, before the app.js script
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- After moving a helper, `app.js` throws a "already declared"/ReferenceError in a
  quick `node -e "require('./public/card-format')"` sanity check - a definition was
  half-moved.
- The stage-label extraction (Step 2) can't be separated from DOM strings cleanly -
  skip Step 2, keep Step 1, and say so.
- `public/app.js` has drifted structurally from the symbols named in "Current state".

## Maintenance notes

- New pure UI helpers should go straight into `card-format.js` (or a sibling
  extracted module), never inline in `app.js`, so they stay testable.
- The DOM assembly in `cardHTML` remains untested by design - that boundary
  (pure logic tested, DOM wiring manual) is the intended coverage line for this
  zero-dep frontend.
- A reviewer should diff the rendered card before/after to confirm extraction was
  behavior-preserving.
