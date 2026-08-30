# Plan 001: Guard request-derived filesystem paths

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
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `e0825c3`, 2026-08-07

## Why this matters

Several routes build filesystem paths directly from `req.params` (the `:id` /
`:slug` in the URL). Express URL-decodes those params, so a value like
`..%2f..%2f..%2ftmp%2fx` becomes `../../../tmp/x` and escapes the data
directory. This was confirmed live: a `POST` to the bridge result route with a
traversal `:id` wrote a file to `/tmp` outside `DATA_DIR` and returned HTTP 200.
The bridge routes are especially exposed because they set
`Access-Control-Allow-Origin: *` and `Access-Control-Allow-Private-Network: true`
(`server.js:58-61`), so any web page open in a family member's browser can reach
them across origins. This is arbitrary file write/read/move on the host, which
goes beyond the app's accepted "no auth on the LAN" posture. Legitimate ids and
slugs are always slug-shaped (`^[a-z0-9-]+$`), so a strict guard rejects nothing
real.

## Current state

- `lib/store.js` - JSON-on-disk store. Every path is built from an id/slug:
  - `lib/store.js:17` - `const dir = id => path.join(root, id);`
  - `lib/store.js:18` - `const jsonPath = id => path.join(dir(id), 'pokemon.json');`
  - `lib/store.js:103` - `const trainerDir = slug => path.join(trainersDir, slug);`
  - These feed `get`, `save`, `saveArt`, `readArt`, `backupArt`, `archive`, `renameFor`, and every trainer function. `archive`/`renameFor`/`trainerArchive` do `fs.renameSync` on the derived dir - a traversal id there moves a directory outside the tree.
- `server.js` bridge write routes build paths from the raw param:
  - `server.js:99` - `fs.writeFileSync(path.join(bridgeJobsDir(), `${req.params.id}.${ext}`), Buffer.from(b64, 'base64'));`
  - `server.js:105` - `fs.writeFileSync(path.join(bridgeJobsDir(), `${req.params.id}.error`), String(req.body.message || 'driver error'));`
- Existing exemplar to match: `lib/store.js:14-15` already defines a `slugify`
  helper and the codebase already validates shapes elsewhere. Follow the plain
  Node, no-dependency style (throw a normal `Error`; the routes' `wrap()` /
  global handler turn it into a response).

Legitimate id format (for reference, do not change it): `create()` builds ids as
`` `${slug}-${Date.now().toString(36)}` `` (`lib/store.js:35`), e.g.
`sparkmouse-lqx7z2`. Trainer slugs come from `slugify(name)`. Both match
`^[a-z0-9-]+$`.

## Commands you will need

| Purpose | Command      | Expected on success        |
|---------|--------------|----------------------------|
| Tests   | `npm test`   | all pass (48 today + new)  |
| Run app | `PORT=3399 DATA_DIR=/tmp/pm-probe node --env-file=.env server.js` | prints "Pokemine running" |

## Scope

**In scope** (the only files you should modify):
- `lib/store.js`
- `server.js`
- `test/pokemine.test.js` (add tests)

**Out of scope** (do NOT touch, even though they look related):
- The CORS / Private-Network headers at `server.js:57-64` - loosening or
  removing them is a separate decision; this plan only stops path escape.
- The id/slug *generation* logic in `create()` / `trainerCreate()` - it already
  produces safe values; don't alter the format.
- Any route's response shape.

## Git workflow

- Branch: `advisor/001-path-traversal-guard`
- Commit style matches `git log` (conventional commits), e.g.
  `fix(security): reject traversal in request-derived paths`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a shared id/slug validator in lib/store.js

Near the top of `lib/store.js` (just after `slugify` at line 15), add a single
guard and use it wherever a raw id/slug becomes a path. Target shape:

```js
// Reject any id/slug that isn't slug-shaped, so a request param can never
// traverse outside the data tree (e.g. "..%2f.." decoded by Express).
const SAFE_ID = /^[a-z0-9-]+$/;
const safe = id => {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) {
    throw new Error(`invalid id: ${id}`);
  }
  return id;
};
```

Then apply it at the two path-builder chokepoints so every caller is covered at
once:

```js
const dir = id => path.join(root, safe(id));
const trainerDir = slug => path.join(trainersDir, safe(slug));
```

Because `jsonPath`, `saveArt`, `readArt`, `backupArt`, `archive`, `renameFor`,
and all trainer functions route through `dir()` / `trainerDir()`, this one change
covers them. Do not sprinkle `safe()` at each call site.

**Verify**: `npm test` -> all existing tests pass (the test ids are all
slug-shaped, so nothing legitimate is rejected).

### Step 2: Guard the bridge write routes in server.js

The bridge routes build paths from `req.params.id` without going through the
store. Add a guard at the top of each handler at `server.js:97` and
`server.js:104`. Target shape (reuse the same regex; do not import store internals):

```js
const SAFE_BRIDGE_ID = /^[a-z0-9-]+$/;
// inside each of the /result and /error handlers, first line:
if (!SAFE_BRIDGE_ID.test(req.params.id)) return res.status(400).json({ error: 'bad job id' });
```

Bridge job ids are created server-side the same slug+timestamp way, so real
drivers are unaffected.

**Verify**: start the app and confirm a traversal id is rejected and a normal id
is accepted:

```
PORT=3399 DATA_DIR=/tmp/pm-probe node --env-file=.env server.js &
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "http://localhost:3399/api/bridge/jobs/..%2f..%2f..%2ftmp%2fpm-ESCAPE/result" \
  -H 'Content-Type: application/json' -d '{"b64":"aGk=","mime":"image/png"}'
# expected: 400
test -e /tmp/pm-ESCAPE.png && echo "LEAKED" || echo "contained"
# expected: contained
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "http://localhost:3399/api/bridge/jobs/normalid/result" \
  -H 'Content-Type: application/json' -d '{"b64":"aGk=","mime":"image/png"}'
# expected: 200
```

Kill the server after (`kill %1`) and `rm -rf /tmp/pm-probe /tmp/pm-ESCAPE.png`.

### Step 3: Add regression tests

In `test/pokemine.test.js`, add tests near the other `store:` tests (the file
already does `store.init(...)` at the top and uses `node:test` + `assert`).

```js
test('store: rejects traversal ids', () => {
  assert.throws(() => store.get('../../etc/passwd'), /invalid id/);
  assert.throws(() => store.archive('..%2f..'), /invalid id/);
  assert.throws(() => store.trainerGet('../x'), /invalid id/);
});

test('store: accepts normal slug ids', () => {
  const rec = store.create({ stages: [{ name: 'Safey' }] });
  assert.doesNotThrow(() => store.get(rec.id));
});
```

**Verify**: `npm test` -> all pass, including the 2 new tests.

## Test plan

- New tests: traversal rejection (`store.get`/`archive`/`trainerGet` throw
  `invalid id`) and normal-id acceptance. In `test/pokemine.test.js`, modeled on
  the existing `store: create/list/get/save round trip` test (line ~36).
- The bridge-route guard is verified by the Step 2 curl probe (there is no
  bridge-route unit test harness for the write side; the server-side job
  contract tests remain green).
- Verification: `npm test` -> all pass, 2 new tests.

## Done criteria

ALL must hold:

- [ ] `npm test` exits 0; the 2 new traversal tests exist and pass
- [ ] The Step 2 probe prints `400`, `contained`, `200` in that order
- [ ] `grep -n "safe(" lib/store.js` shows `dir`/`trainerDir` using the guard
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts don't match the live code (drift).
- Adding `safe()` to `dir()`/`trainerDir()` breaks existing tests - that would
  mean some legitimate id is not slug-shaped; report which before loosening the
  regex.
- The fix appears to need changes outside `lib/store.js` / `server.js` /
  `test/pokemine.test.js`.

## Maintenance notes

- If bridge job ids ever change format (e.g. add uppercase or dots), widen
  `SAFE_ID` deliberately - never remove it.
- A reviewer should confirm the guard sits in `dir()`/`trainerDir()` (one place),
  not duplicated per function.
- Deferred out of scope: tightening the bridge CORS/PNA headers. Track separately;
  this plan makes traversal impossible regardless of who can reach the route.
