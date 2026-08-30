# Plan 002: Make the on-disk store resilient to Drive stalls

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report - do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e0825c3..HEAD -- lib/store.js server.js`
> If either file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `e0825c3`, 2026-08-07

## Why this matters

`DATA_DIR` is, in practice, a Google Drive-synced folder (see README and
`architecture.md`), so half-written and momentarily-unreadable `pokemon.json`
files are a when-not-if, not a rare edge case. Today a single corrupt or partial
`pokemon.json` makes `list()` throw (unguarded `JSON.parse` inside a `.map`),
which breaks `/api/pokemon`, the dex, and `store.create` (which calls `list()`).
Worse, `init()` runs `migrateNumbers()` -> `list()` at startup, so one bad file
**prevents the server from starting at all**. The bridge job reader already
guards this exact hazard (`server.js:87-91` wraps its parse in try/catch and skips
half-written files); the store does not. Separately, a missing id currently
throws `ENOENT`, which surfaces to the client as an HTTP 500 with the full
filesystem path in the body (confirmed live) - it should be a clean 404 with no
path leak. After this plan, one bad file drops out of lists with a warning
instead of bricking the app, writes are atomic, and missing records return 404.

## Current state

`lib/store.js`:

```js
// lib/store.js:20-25
function list() {
  return fs.readdirSync(root)
    .filter(id => fs.existsSync(jsonPath(id)))
    .map(id => JSON.parse(fs.readFileSync(jsonPath(id), 'utf8')))
    .sort((a, b) => a.number - b.number);
}

// lib/store.js:27-29
function get(id) {
  return JSON.parse(fs.readFileSync(jsonPath(id), 'utf8'));
}

// lib/store.js:62-65
function save(record) {
  fs.writeFileSync(jsonPath(record.id), JSON.stringify(record, null, 2));
  return record;
}
```

`trainersList()` (`lib/store.js:105-114`) and `trainerGet()` (`:130-134`) have
the same unguarded `JSON.parse` shape.

The exemplar to copy - the store's own sibling code already does the safe thing
for the cost ledger and the bridge reader:

```js
// server.js:87-91 - bridge job reader, the pattern to mirror
try {
  const { prompt, timeoutMs } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  jobs.push({ id, prompt, timeoutMs });
  bridge.claims.set(id, now);
} catch { /* half-written job file, pick it up next poll */ }
```

Routes that call `store.get` and forward its throw as a 500:

```js
// server.js:172 - GET one pokemon
app.get('/api/pokemon/:id', (req, res) => res.json(store.get(req.params.id)));
```

`evolve` (`server.js:239`), `alter` (`:287`), `patch` (`:324`) also call
`store.get(req.params.id)` first. The global error handler
(`server.js:337-348`) turns any throw into `res.status(500).json({ error: err.message })`,
leaking the fs path.

## Commands you will need

| Purpose | Command      | Expected on success       |
|---------|--------------|---------------------------|
| Tests   | `npm test`   | all pass (48 today + new) |

## Scope

**In scope**:
- `lib/store.js`
- `server.js` (route-level 404 handling only, described in Step 3)
- `test/pokemine.test.js` (add tests)

**Out of scope**:
- The number-allocation race (that's plan 003; do not add locking here).
- `saveArt`/`readArt` binary paths - image reads are not JSON and are not the
  corruption hazard; leave them.
- The global error handler's shape at `server.js:337-348` beyond what Step 3 needs.

## Git workflow

- Branch: `advisor/002-store-drive-resilience`
- Commit style: conventional commits, e.g.
  `fix(store): skip corrupt records, atomic writes, 404 on missing`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Make list() and trainersList() skip unreadable records

Wrap each per-record parse in try/catch and drop failures with a `console.warn`,
mirroring the bridge reader. Target shape for `list()`:

```js
function list() {
  return fs.readdirSync(root)
    .filter(id => fs.existsSync(jsonPath(id)))
    .map(id => {
      try { return JSON.parse(fs.readFileSync(jsonPath(id), 'utf8')); }
      catch (e) { console.warn(`skipping unreadable ${id}: ${e.message}`); return null; }
    })
    .filter(Boolean)
    .sort((a, b) => a.number - b.number);
}
```

Apply the same try/catch-skip to the `.map` in `trainersList()`
(`lib/store.js:105-114`).

**Verify**: `npm test` -> all pass (no behavior change for valid files).

### Step 2: Make save() atomic

Write to a temp file in the same directory, then `renameSync` over the target
(rename is atomic on a local fs and avoids leaving a half-written `pokemon.json`
if the process dies mid-write). Target shape:

```js
function save(record) {
  const target = jsonPath(record.id);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
  fs.renameSync(tmp, target);
  return record;
}
```

**Verify**: `npm test` -> all pass.

### Step 3: Return 404 (not 500) for a missing pokemon/trainer

Make `get`/`trainerGet` return `null` on `ENOENT` instead of throwing, and have
the routes respond 404 when the record is missing. Target shape in `store.js`:

```js
function get(id) {
  try { return JSON.parse(fs.readFileSync(jsonPath(id), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
```

Do the same for `trainerGet` (return `null` on `ENOENT`).

Then update the routes that call them to 404 on `null`. The GET route becomes:

```js
app.get('/api/pokemon/:id', (req, res) => {
  const rec = store.get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  res.json(rec);
});
```

For `evolve` / `alter` / `patch` (each starts with
`const record = store.get(req.params.id);`), add immediately after that line:

```js
if (!record) return res.status(404).json({ error: 'Not found' });
```

Note the evolve/create/alter routes are SSE and set headers later; this 404 check
runs BEFORE any SSE headers are set, so a plain `res.status(404).json` is correct
there. Do not move the check below the `res.set('Content-Type', 'text/event-stream')`
lines.

For trainer routes that call `store.trainerGet(req.params.slug)`, add the same
`if (!trainer) return res.status(404)...` guard.

**Verify**: start nothing; run `npm test` -> all pass, then confirm with the new
test in Step 4.

### Step 4: Add regression tests

In `test/pokemine.test.js`:

```js
test('store: list skips a corrupt record instead of throwing', () => {
  const rec = store.create({ stages: [{ name: 'Corruptible' }] });
  const p = path.join(process.env.DATA_DIR, 'pokemon', rec.id, 'pokemon.json');
  fs.writeFileSync(p, '{ not valid json');
  assert.doesNotThrow(() => store.list());          // does not throw
  assert.ok(!store.list().some(r => r.id === rec.id)); // bad record dropped
});

test('store: get returns null for a missing id', () => {
  assert.equal(store.get('nope-does-not-exist'), null);
});

test('GET /api/pokemon/:id returns 404 for missing id', async () => {
  const res = await fetch(`${base}/api/pokemon/nope-missing`);
  assert.equal(res.status, 404);
});
```

Note: the HTTP test needs the same server-start pattern the other route tests in
this file already use. Find an existing `fetch(`${base}...` test in
`test/pokemine.test.js` and mirror its setup (the file already stands up the app
and defines `base`); if no `base` helper exists in your section, model the new
HTTP test on the nearest existing `fetch`-based test rather than inventing one.

**Verify**: `npm test` -> all pass, including the 3 new tests.

## Test plan

- New tests: corrupt-record-skipped, `get` returns null on missing, GET route
  404 on missing. In `test/pokemine.test.js`, modeled on the existing store and
  route tests.
- Verification: `npm test` -> all pass, 3 new tests.

## Done criteria

ALL must hold:

- [ ] `npm test` exits 0; 3 new tests present and passing
- [ ] `grep -n "catch" lib/store.js` shows guards in `list`, `get`, `trainersList`, `trainerGet`
- [ ] `grep -n "\.tmp" lib/store.js` shows the atomic-write temp file in `save`
- [ ] `grep -n "404" server.js` shows the missing-record guards
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The "Current state" excerpts don't match live code (drift).
- Adding the 404 guard to an SSE route would require setting headers first -
  re-read Step 3; the guard must precede any `res.set(... text/event-stream ...)`.
- A new test can't find a working server-start/`base` pattern in the file - report
  rather than standing up a bespoke server harness.

## Maintenance notes

- Any new store reader that does `JSON.parse(fs.readFileSync(...))` must adopt the
  same try/catch-skip - the store's invariant is now "one bad file never bricks a
  list".
- `save()` is now atomic; plan 003 (number allocation) builds on this - keep the
  temp-then-rename shape when serializing writes.
- A reviewer should confirm the 404 checks sit before SSE headers on evolve/alter.
