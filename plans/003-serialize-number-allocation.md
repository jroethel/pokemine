# Plan 003: Serialize Pokedex/collector number allocation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report - do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e0825c3..HEAD -- lib/store.js server.js`
> If either changed since this plan was written, compare "Current state" against
> live code; on a mismatch, treat it as a STOP condition. NOTE: this plan expects
> plan 002 to have landed (atomic `save`, guarded `get`). If 002 is not yet done,
> STOP and do 002 first.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/002-store-drive-resilience.md
- **Category**: bug
- **Planned at**: commit `e0825c3`, 2026-08-07

## Why this matters

Both the per-Pokemon dex number and the per-stage global collector number are
allocated by a read-then-write with no lock: `create()` computes
`number = max(all record numbers) + 1` and `nextNumber()` computes
`max(all stage numbers) + 1`, then the record is saved *seconds later* (after a
multi-second image generation). Two kids hitting Generate at nearly the same time
each read the same max and both write `number = N+1`, producing duplicate dex
numbers and duplicate collector numbers - and those `#0007`-style numbers are the
identity the whole app is built around. The window is wide because the write lands
after image gen. The fix is to serialize the allocate-and-write section; a single
in-process promise chain (mutex) is sufficient because the server is a single
Node process.

## Current state

```js
// lib/store.js:31-40
function create(record) {
  const number = list().reduce((m, p) => Math.max(m, p.number), 0) + 1;
  const slug = (record.stages[0].name || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'pokemon';
  const id = `${slug}-${Date.now().toString(36)}`;
  const full = { id, number, createdAt: new Date().toISOString(), ...record };
  full.stages[0].number = nextNumber(); // per-stage global collector number
  fs.mkdirSync(dir(id), { recursive: true });
  return save(full);
}

// lib/store.js:43-46
function nextNumber() {
  return list().reduce((m, r) =>
    r.stages.reduce((m2, s) => Math.max(m2, s.number || 0), m), 0) + 1;
}
```

The two writers that race:

- **Create**: `server.js` create route calls `store.create(...)` (`server.js:257-260`),
  which allocates both numbers. The route calls it AFTER awaiting text + image gen,
  so two overlapping creates have a long shared window.
- **Evolve**: `server.js` evolve route pushes a stage with
  `number: store.nextNumber()` (`server.js:272`) and then `store.save(record)`
  (`:277`), also after awaiting image gen.

There is no existing async-mutex helper in the repo. Keep it tiny and dependency-free.

## Commands you will need

| Purpose | Command      | Expected on success       |
|---------|--------------|---------------------------|
| Tests   | `npm test`   | all pass (current + new)  |

## Scope

**In scope**:
- `lib/store.js` (add a mutex; wrap `create`; add a serialized number allocator used by evolve)
- `server.js` (evolve route: allocate the stage number through the serialized path)
- `test/pokemine.test.js` (add a concurrency test)

**Out of scope**:
- Corrupt-file handling and atomic writes - already done in plan 002; don't redo.
- Path guards - plan 001; don't touch.
- Do NOT introduce a file-lock library or any dependency (zero-dep rule).

## Git workflow

- Branch: `advisor/003-serialize-number-allocation`
- Commit style: conventional commits, e.g.
  `fix(store): serialize dex/collector number allocation to prevent duplicates`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a minimal in-process mutex to lib/store.js

Near the top of `lib/store.js`, add a promise-chain mutex (no dependency):

```js
// Single-process serialization: number allocation + save must not interleave,
// or two concurrent creates read the same max and collide on dex/collector numbers.
// ponytail: global in-process lock - fine for one Node process; revisit only if
// the server ever forks to multiple workers.
let _chain = Promise.resolve();
function withLock(fn) {
  const run = _chain.then(fn, fn);
  _chain = run.catch(() => {}); // keep the chain alive even if fn rejects
  return run;
}
```

Export `withLock` in `module.exports` so the evolve route can use it.

**Verify**: `npm test` -> all pass (nothing calls it yet).

### Step 2: Serialize create()

Make `create()` do its allocate-and-save inside the lock. Because `create` is
currently synchronous, convert it to return a promise via `withLock`. Target
shape:

```js
function create(record) {
  return withLock(() => {
    const number = list().reduce((m, p) => Math.max(m, p.number), 0) + 1;
    const slug = slugify(record.stages[0].name) || 'pokemon';   // (uses the shared slugify; see plan 004 if not yet applied)
    const id = `${slug}-${Date.now().toString(36)}`;
    const full = { id, number, createdAt: new Date().toISOString(), ...record };
    full.stages[0].number = nextNumber();
    fs.mkdirSync(dir(id), { recursive: true });
    return save(full);
  });
}
```

`create` now returns a Promise. Find its callers and `await` them. The create
route already runs in an `async` handler: change `const record = store.create(...)`
at `server.js:257` to `const record = await store.create(...)`.

Also check `test/pokemine.test.js` for synchronous `store.create(...)` calls -
they must become `await store.create(...)` inside `async` tests, or use
`.then`. Update every call site; a missed one will get a Promise where it expects
a record and fail loudly.

**Verify**: `npm test` -> all pass (after updating test call sites).

### Step 3: Serialize the evolve stage-number allocation + save

In the evolve route (`server.js`), the sequence that must be atomic is:
allocate `store.nextNumber()`, push the stage, and `store.save(record)`
(`server.js:272-277`). Wrap just that allocate-push-save in `store.withLock`:

```js
await store.withLock(() => {
  record.stages.push({
    ...stageData, prompt: guidance, number: store.nextNumber(),
    ...(variant ? { variant } : {}),
    art: store.saveArt(record.id, `stage-${stageNo}.${extFor(art.mime)}`, art.data),
  });
  store.save(record);
});
```

(The image generation stays OUTSIDE the lock - only the number allocation and
save are serialized, so generation still runs in parallel across requests.)

**Verify**: `npm test` -> all pass.

### Step 4: Add a concurrency regression test

In `test/pokemine.test.js`:

```js
test('store: concurrent creates get distinct dex numbers', async () => {
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      store.create({ stages: [{ name: `Racer${i}` }] })));
  const numbers = results.map(r => r.number);
  assert.equal(new Set(numbers).size, numbers.length); // all distinct
  const stageNums = results.map(r => r.stages[0].number);
  assert.equal(new Set(stageNums).size, stageNums.length); // collector numbers distinct too
});
```

**Verify**: `npm test` -> all pass, including the new test (and it FAILS if you
temporarily remove `withLock` from `create`, proving it catches the race).

## Test plan

- New test: 5 concurrent `store.create` calls all get distinct `number` and
  distinct `stages[0].number`.
- Sanity check the test's teeth: with `withLock` removed the test should fail;
  confirm once, then restore.
- Verification: `npm test` -> all pass, 1 new test.

## Done criteria

ALL must hold:

- [ ] `npm test` exits 0; the concurrency test present and passing
- [ ] `grep -n "withLock" lib/store.js server.js` shows the lock in `create` and the evolve save
- [ ] Every `store.create(` call site is awaited (`grep -n "store.create(" server.js test/pokemine.test.js` - each in an async context with `await`)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Plan 002 has not landed (atomic save / guarded get missing) - do 002 first.
- Converting `create` to async surfaces a synchronous caller that can't be made
  async without a larger change - report the call site.
- The "Current state" excerpts don't match live code (drift).

## Maintenance notes

- The mutex is per-process. If the server is ever run under a cluster/multiple
  workers, this no longer holds - move to a persisted monotonic counter file
  (allocate under an `O_EXCL` lockfile) at that point. The `ponytail:` comment in
  Step 1 records this ceiling.
- A reviewer should confirm image generation stays OUTSIDE the lock (only
  allocate+save are serialized), or throughput drops to one generation at a time.
