# Plan 003: Record-update integrity - lost updates and durable number allocation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report - do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: this plan runs LAST (wave 4), on a `main` that
> already carries 001, 002, 004, and 005. Anchor the drift check to the tip of
> wave 3 (the commit `main` was at when wave 3 merged), NOT `e0825c3`:
> `git diff --stat <wave-3-tip>..HEAD -- lib/store.js server.js`.
> The following are SANCTIONED drift and must NOT be treated as a STOP: 001's
> `safe()` guard in `dir()`/`trainerDir()`, 002's guarded `list()`/`get()` +
> atomic `save()` + 404 routes, and 004's shared `slugify()` inside `create()`.
> STOP only if `create()`, `nextNumber()`, or the evolve/alter route tails differ
> structurally from the "Current state" excerpts below.
> Line numbers below are the pre-wave positions; 002 and 004 shift them, so locate
> each function by symbol, not by line.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/002-store-drive-resilience.md (hard); plans/004-cleanup-deadcode-and-readme.md (ordering)
- **Category**: bug
- **Planned at**: commit `e0825c3`, 2026-08-07; re-scoped 2026-08-08 to GitHub issue #14

## Why this matters

This plan closes two real integrity hazards (GitHub issue #14), not the duplicate-number race the original 003 targeted.
That race does not exist: in the current code number allocation and `save()` are synchronous and contiguous, the image generation completes before that block runs, and Node's single thread serializes concurrent creates, so each sees the other's saved record.
An in-process mutex over that block would have no failing test to justify it, so it is dropped.
The two hazards below DO have failing tests.

Hazard A - concurrent-evolve/alter stale-read lost update.
The evolve route reads the record with `store.get()` BEFORE the multi-second image `await`, then pushes a new stage onto that now-stale copy and saves it.
Two concurrent evolves on one record both read the pre-await copy, and the later save silently discards the earlier evolution - a lost update.
The alter route has the identical read-await-save shape and the identical defect (a concurrent alter+evolve loses whichever saves first).
These stages and their collector numbers are the identity the whole app is built around, so a silent loss is a real bug, not a theoretical one.
The fix is not a lock: after the image `await`, re-read the record fresh, re-validate the invariant, apply the mutation to the fresh copy, then save.
The re-read, re-check, mutate, and save run with no `await` between them, so Node runs them atomically against another request's same block, and the window closes with no locking machinery and no async conversion.

Hazard B - number allocation derived from a lossy `list()`.
Plan 002 makes `list()` silently skip an unreadable record.
Both `create()`'s dex number (`max(record.number) + 1` over `list()`) and the collector number (`nextNumber()`, `max(stage.number) + 1` over `list()`) derive from `list()`, so a record that is transiently unreadable mid Drive-sync drops out of the max, its number is reused for the next create, and a duplicate appears when the file syncs back.
The fix is a persisted monotonic counter file under `DATA_DIR`, read-increment-write synchronously inside the existing sync blocks, seeded once from the current max (idempotent, like `migrateNumbers()`), and never lowered - so numbers survive records transiently vanishing.

## Current state

All excerpts are shown as they read AFTER 002 and 004 land (the state this plan edits).

`lib/store.js` - `init()` (`lib/store.js:6-12`), where the counter will be seeded:

```js
function init(dataDir) {
  root = path.resolve(dataDir, 'pokemon');
  fs.mkdirSync(root, { recursive: true });
  trainersDir = path.resolve(dataDir, 'trainers');
  fs.mkdirSync(trainersDir, { recursive: true });
  migrateNumbers();
}
```

`lib/store.js` - `create()` (`lib/store.js:31-40`), post-004 (shared `slugify`).
The two Hazard-B allocation sites are the first line and the `nextNumber()` line:

```js
function create(record) {
  const number = list().reduce((m, p) => Math.max(m, p.number), 0) + 1; // Hazard B: lossy list()
  const slug = slugify(record.stages[0].name) || 'pokemon';             // 004: shared slugify
  const id = `${slug}-${Date.now().toString(36)}`;
  const full = { id, number, createdAt: new Date().toISOString(), ...record };
  full.stages[0].number = nextNumber();                                 // Hazard B: lossy list()
  fs.mkdirSync(dir(id), { recursive: true });
  return save(full);
}

// lib/store.js:43-46 - list-derived, used by migrateNumbers() and the existing test.
function nextNumber() {
  return list().reduce((m, r) =>
    r.stages.reduce((m2, s) => Math.max(m2, s.number || 0), m), 0) + 1;
}
```

`server.js` - evolve route (Hazard A), post-002 (the 404 guard from 002 is already present).
The stale read is the `store.get` near the top; the mutation of that stale copy is the push + save AFTER the image `await`:

```js
// server.js:238-283 (post-002)
app.post('/api/pokemon/:id/evolve', wrap(async (req, res) => {
  const { provider = DEFAULT_PROVIDER, instruction } = req.body;
  const record = store.get(req.params.id);                 // <-- read (stale by the time we save)
  if (!record) return res.status(404).json({ error: 'Not found' }); // 002
  if (record.stages.length >= 3) {
    return res.status(400).json({ error: `${record.stages[2].name} is fully evolved! No Pokemon evolves more than twice.` });
  }
  // ... SSE headers ...
  try {
    // ... text.evolvedStage await, then the image await:
    const art = await autocrop(await p.generate({ prompt, reference }));
    logCost(provider);
    record.stages.push({                                   // <-- mutates the STALE copy
      ...stageData, prompt: guidance, number: store.nextNumber(),
      ...(variant ? { variant } : {}),
      art: store.saveArt(record.id, `stage-${stageNo}.${extFor(art.mime)}`, art.data),
    });
    store.save(record);                                     // <-- clobbers a concurrent evolve's save
    SSE(res, 'done', { record });
  } catch (e) {
    SSE(res, 'error', { message: e.message });
  } finally {
    res.end();
  }
}));
```

`server.js` - alter route (Hazard A), post-002. Same read-await-save shape:

```js
// server.js:285-315 (post-002)
app.post('/api/pokemon/:id/alter', wrap(async (req, res) => {
  const { instruction, stage: stageIndex, provider = DEFAULT_PROVIDER } = req.body;
  const record = store.get(req.params.id);                 // <-- read (stale by the time we save)
  if (!record) return res.status(404).json({ error: 'Not found' }); // 002
  const idx = stageIndex === undefined ? record.stages.length - 1 : stageIndex;
  const stage = record.stages[idx];
  // ... reads current art, builds prompt, then the image await:
  const art = await autocrop(await p.generate({ prompt, reference }));
  logCost(provider);
  store.backupArt(record.id, stage.art);
  stage.art = store.saveArt(record.id, `stage-${idx + 1}.${extFor(art.mime)}`, art.data);
  if (said) stage.description += ` Recently altered: ${said}.`;
  store.save(record);                                       // <-- clobbers a concurrent write
  res.json(record);
}));
```

The PATCH route (`server.js:322-335`) reads then saves with NO `await` between, so it has no stale-read window and needs no change.
The create route allocates fresh numbers only (no read-modify), so it is a Hazard-B site, not a Hazard-A site.

## Commands you will need

| Purpose      | Command                                  | Expected on success                    |
|--------------|------------------------------------------|----------------------------------------|
| Tests        | `npm test`                               | all pass (prior waves' tests + 2 new)  |
| Teeth (pre)  | `node --test test/pokemine.test.js 2>&1 \| grep -E "^not ok"` | 2 new tests fail BEFORE the fix |
| Counter file | `cat "$DATA_DIR/counters.json"`          | `{ "dex": N, "collector": M }`         |

## Scope

**In scope**:
- `lib/store.js` (persisted counter: functions + seed in `init`; route `create` through it; export `allocCollector`)
- `server.js` (evolve route: re-read after await + counter allocator; alter route: re-read after await)
- `test/pokemine.test.js` (2 new tests)

**Out of scope**:
- Corrupt-file handling, atomic `save`, and 404s - done in plan 002; do not redo.
- Path guards - plan 001; do not touch.
- Converting `create()`, `save()`, or the store to async - the counter is synchronous file I/O and the routes are already `async`; no async ripple is needed and none should be introduced.
- Any in-process mutex / `withLock` - there is no failing test for the race it would guard; do not add it.
- The bridge CORS/PNA headers (issue #12) and Gemini parts dedup (issue #13).
- Do NOT introduce a file-lock library or any dependency (zero-dep rule).

## Git workflow

- Branch: `advisor/003-record-update-integrity`
- Commit style: conventional commits, e.g.
  `fix(store): durable monotonic number counter`;
  `fix(server): re-read record after image await to prevent lost updates`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a persisted monotonic counter to lib/store.js (Hazard B)

At the top of `lib/store.js`, add `countersPath` to the module-level `let` (alongside `root`, `trainersDir`).
Set it in `init()` and seed it AFTER `migrateNumbers()` so the seed reflects any freshly stamped stages:

```js
let root, trainersDir, countersPath;

function init(dataDir) {
  root = path.resolve(dataDir, 'pokemon');
  fs.mkdirSync(root, { recursive: true });
  trainersDir = path.resolve(dataDir, 'trainers');
  fs.mkdirSync(trainersDir, { recursive: true });
  countersPath = path.resolve(dataDir, 'counters.json');
  migrateNumbers();
  initCounters();
}
```

Then add the counter functions (near `nextNumber`):

```js
// Persisted monotonic number counters. Allocation must NOT derive from list(),
// which (post-002) silently skips a transiently-unreadable record and would
// reuse its number. The counter survives records vanishing and is never lowered.
function writeCounters(c) {
  const tmp = `${countersPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2));
  fs.renameSync(tmp, countersPath); // atomic, mirrors 002's save()
}

// Seed/raise the counter to the current on-disk max. Idempotent, like
// migrateNumbers(): never lowers, so a later run during a Drive stall (list()
// missing a record) leaves the persisted high-water mark untouched.
// ponytail: a record unreadable during the very first cold-start seed can seed
// low; acceptable one-time ceiling, the persisted counter closes every later window.
function initCounters() {
  let cur = null;
  try { cur = JSON.parse(fs.readFileSync(countersPath, 'utf8')); } catch { /* absent or unreadable */ }
  if (cur === null && fs.existsSync(countersPath)) return; // present-but-unreadable: protect it, don't reset
  const dexMax = list().reduce((m, p) => Math.max(m, p.number || 0), 0);
  const colMax = list().reduce((m, r) =>
    r.stages.reduce((m2, s) => Math.max(m2, s.number || 0), m), 0);
  writeCounters({ dex: Math.max(cur?.dex || 0, dexMax), collector: Math.max(cur?.collector || 0, colMax) });
}

function bumpCounter(key) {
  let c;
  try { c = JSON.parse(fs.readFileSync(countersPath, 'utf8')); }
  catch (e) {
    // Unreadable mid-allocation (Drive stall): fail loudly rather than fall back
    // to a lossy list()-derived number that could duplicate. The kid retries.
    throw new Error(`number counter unreadable (${e.message}); try again in a moment`);
  }
  c[key] = (c[key] || 0) + 1;
  writeCounters(c);
  return c[key];
}

const allocDex = () => bumpCounter('dex');
const allocCollector = () => bumpCounter('collector');
```

Add `allocCollector` to `module.exports` (the evolve route needs it; `allocDex` stays internal).
Keep `nextNumber` exported and unchanged - `migrateNumbers()` and the existing per-stage-numbers test still use it.

**Verify**: `npm test` -> all pass (nothing allocates through the counter yet; `initCounters` just writes `counters.json`).

### Step 2: Route create()'s two allocations through the counter (Hazard B)

In `create()`, replace the two `list()`-derived allocations with the counter:

```js
function create(record) {
  const number = allocDex();
  const slug = slugify(record.stages[0].name) || 'pokemon';
  const id = `${slug}-${Date.now().toString(36)}`;
  const full = { id, number, createdAt: new Date().toISOString(), ...record };
  full.stages[0].number = allocCollector();
  fs.mkdirSync(dir(id), { recursive: true });
  return save(full);
}
```

`create()` stays synchronous - no caller changes.

**Verify**: `npm test` -> all pass.
The "create/list/get/save round trip" test still asserts `rec.number === 1`, `rec2.number === 2` (counter seeded at 0 on the empty test store), and the "per-stage numbers" test's relative assertions still hold because every create persists the same value to both the record and the counter.

### Step 3: Evolve route - re-read after await + counter allocator (Hazard A + B)

In the evolve route, replace the push + save block (the part AFTER `logCost(provider);`) with a re-read of the record, a re-check of the fully-evolved invariant, then the mutation applied to the FRESH copy:

```js
    const art = await autocrop(await p.generate({ prompt, reference }));
    logCost(provider);
    // Re-read after the multi-second image await: a concurrent evolve/alter may
    // have saved a new stage while we awaited. Mutating the pre-await copy would
    // silently discard their write. The re-read, re-check, push and save below run
    // with no await between them, so they are atomic against another request.
    const fresh = store.get(record.id);
    if (!fresh) { SSE(res, 'error', { message: 'This Pokemon is gone.' }); return; }
    if (fresh.stages.length >= 3) {
      SSE(res, 'error', { message: `${fresh.stages[2].name} is fully evolved! No Pokemon evolves more than twice.` });
      return;
    }
    const freshStageNo = fresh.stages.length + 1;
    fresh.stages.push({
      ...stageData, prompt: guidance, number: store.allocCollector(),
      ...(variant ? { variant } : {}),
      art: store.saveArt(fresh.id, `stage-${freshStageNo}.${extFor(art.mime)}`, art.data),
    });
    store.save(fresh);
    SSE(res, 'done', { record: fresh });
```

`return` inside the `try` still runs the existing `finally { res.end(); }`, so do not add a second `res.end()`.
Leave the earlier `stageNo`/`variant`/`prev` lines as they are.

Known cosmetic ceiling (not a data bug, do not fix here): the `variant` roll and the reference-image `prev` are computed from the pre-await copy, so under concurrent evolves the second stage may reference the pre-concurrency art or miss a special-variant re-roll.
The saved stage and its number are correct; only the art styling can drift.

**Verify**: `npm test` -> all pass.

### Step 4: Alter route - re-read after await (Hazard A)

In the alter route, replace the block AFTER `logCost(provider);` with a re-read, then apply the art + description mutation to the fresh copy:

```js
  const art = await autocrop(await p.generate({ prompt, reference }));
  logCost(provider);
  // Re-read after the await so a concurrent evolve/alter isn't clobbered (lost update).
  const fresh = store.get(record.id);
  if (!fresh) return res.status(404).json({ error: 'Not found' });
  const freshStage = fresh.stages[idx];
  if (!freshStage) return res.status(404).json({ error: 'Not found' });
  store.backupArt(fresh.id, freshStage.art);
  freshStage.art = store.saveArt(fresh.id, `stage-${idx + 1}.${extFor(art.mime)}`, art.data);
  if (said) freshStage.description += ` Recently altered: ${said}.`;
  store.save(fresh);
  res.json(fresh);
```

Alter is not an SSE route (it returns `res.json`), so the 404 responses are correct here.
Leave the pre-await lines (`stage`, `current`, `reference`, `prompt`) as they are - they only feed the image generation input, not the save.

**Verify**: `npm test` -> all pass.

### Step 5: Add the two regression tests (with teeth)

Add both tests to `test/pokemine.test.js`.
`store`, `parseResponseBody`, and `getProvider` are already imported at the top of the file; mirror the existing `api:` route tests for the server harness.

```js
test('api: concurrent evolves do not lose an update (re-read after await)', async () => {
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes('generativelanguage')) {
      const stage = { name: 'Evo', category: 'The Evo Pokemon', types: ['Fire'], hp: 70,
        flavor: 'f', moves: [{ name: 'Hit', damage: 30, text: 't' }], artPrompt: 'a', description: 'd', backstory: 'b' };
      return { json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(stage) }] } }] }) };
    }
    return realFetch(url, opts);
  };
  const app = require('../server');
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (p, b) => fetch(`${base}${p}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
  }).then(parseResponseBody);
  const mock = getProvider('mock');
  const realGen = mock.generate;

  try {
    const created = await post('/api/pokemon', { prompt: 'an evo pokemon', provider: 'mock' }); // 1 stage
    // Barrier: hold BOTH image generations until both evolve handlers have passed
    // store.get() and reached the image await, forcing the stale-read interleave.
    let release, arrived = 0;
    const gate = new Promise(r => (release = r));
    mock.generate = async a => { if (++arrived === 2) release(); await gate; return realGen(a); };

    await Promise.all([
      post(`/api/pokemon/${created.id}/evolve`, { provider: 'mock' }),
      post(`/api/pokemon/${created.id}/evolve`, { provider: 'mock' }),
    ]);
    // Both evolutions must persist: 1 -> 2 -> 3. Without the re-read the second save
    // clobbers the first and the record is stuck at 2 stages (a lost update).
    const final = store.get(created.id);
    assert.equal(final.stages.length, 3);
    const nums = final.stages.map(s => s.number);
    assert.equal(new Set(nums).size, nums.length); // collector numbers distinct
  } finally {
    srv.close();
    global.fetch = realFetch;
    mock.generate = realGen;
  }
});

test('store: number allocation is not reused when a record is transiently unreadable', () => {
  const a = store.create({ stages: [{ name: 'Keeper' }] });          // highest dex + collector so far
  const p = path.join(process.env.DATA_DIR, 'pokemon', a.id, 'pokemon.json');
  const good = fs.readFileSync(p);
  fs.writeFileSync(p, '{ transiently corrupt');                      // Drive stall: list() now skips a
  const b = store.create({ stages: [{ name: 'Newcomer' }] });        // must advance past a, not reuse it
  fs.writeFileSync(p, good);                                         // Drive settles: a reappears
  // Monotonic counter => b is strictly above a's numbers regardless of any gaps.
  // Lossy list() allocation => b <= a's numbers (a, the max, was skipped), so both fail.
  assert.ok(b.number > a.number, `dex ${b.number} must exceed ${a.number}`);
  assert.ok(b.stages[0].number > a.stages[0].number, 'collector number must advance');
  const dex = store.list().map(r => r.number);
  assert.equal(new Set(dex).size, dex.length, 'dex numbers unique after a reappears');
});
```

**Verify (teeth first, before Steps 1-4)**: if you write the tests before the fixes, run
`node --test test/pokemine.test.js 2>&1 | grep -E "^not ok"` and confirm BOTH new tests fail:

- `not ok ... api: concurrent evolves do not lose an update` - pre-fix both evolves read the length-1 copy, both push to length 2, the second save clobbers the first, so `final.stages.length` is 2, not 3.
- `not ok ... store: number allocation is not reused when a record is transiently unreadable` - pre-fix `create(b)` derives its numbers from a `list()` that skips the corrupt `a` (the current max), so `b.number <= a.number` and the `>` assertions fail.

Then apply Steps 1-4 and rerun `npm test` -> all pass.

## Test plan

- Hazard A: route-level test, two concurrent evolve POSTs held at a `mock.generate` barrier so both pass `store.get()` before either saves.
  Robust to scheduler order: the stale read is guaranteed (both `get()`s precede both saves), and the fixed code's re-read+save is synchronous, so whichever handler resumes second sees the other's save -> deterministic length 3.
  No production seam or refactor is needed - `store.get()` already sits before the awaits and the mutate+save is already synchronous; the only test device is the existing `mock.generate` override pattern.
- Hazard B: store-level test, a create while a prior record is unreadable, asserting the new numbers advance strictly past the (temporarily hidden) max.
- Verification: `npm test` -> all pass, 2 new tests.

## Done criteria

ALL must hold:

- [ ] `npm test` exits 0; the 2 new tests present and passing
- [ ] Confirmed once that both new tests FAIL when their matching fix is reverted (teeth)
- [ ] `grep -n "allocCollector\|allocDex\|bumpCounter\|initCounters" lib/store.js` shows the counter wired into `create` and exported
- [ ] `grep -n "list()" lib/store.js` shows `create()` no longer derives a number from `list()` (only `initCounters`/`migrateNumbers`/`nextNumber` may)
- [ ] `grep -n "store.get(record.id)\|store.get(req.params.id)" server.js` shows the evolve and alter routes re-reading AFTER the image await
- [ ] `grep -n "allocCollector" server.js` shows the evolve route allocating the stage number through the counter
- [ ] No `withLock`/mutex and no async conversion of `create()` were introduced (`grep -n "withLock\|await store.create" lib/store.js server.js` -> empty)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Plan 002 has not landed (guarded `list`/`get`, atomic `save`, 404 routes missing) - do 002 first; Hazard B does not even exist without 002.
- Plan 004 has not landed - `create()` will still inline the slugify chain; the Step 2 excerpt won't match. Do 004 first (both edit `create()`), or expect a small rebase in that function.
- `create()`, `nextNumber()`, or the evolve/alter route tails differ structurally from the "Current state" excerpts (unexpected drift beyond the sanctioned 001/002/004 changes).
- Either new test does NOT fail before the fix (a toothless test) - the original 003's fatal flaw; do not proceed until the teeth are confirmed.

## Maintenance notes

- The counter is the single source of truth for new numbers; never reintroduce `list()`-derived allocation, which is lossy under Drive stalls.
- `nextNumber()` remains list-derived and is for `migrateNumbers()` (init-time stamping) only - do not use it to allocate live numbers.
- Routing `create()` through the counter also removes its two `list()` scans (the PERF-01 item the README parked); this is incidental, not a goal.
- The re-read-after-await pattern is now the store contract for any route that reads a record, awaits, then saves it: re-read the fresh copy before mutating.
  A reviewer should confirm no route saves a copy it read before an `await`.
- A `counters.json` unreadable during allocation fails the request loudly (safe: no duplicate) rather than falling back to a possibly-duplicate number.
