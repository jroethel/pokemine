const fs = require('fs');
const path = require('path');

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

const slugify = s => (s || '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Reject any id/slug that isn't slug-shaped, so a request param can never
// traverse outside the data tree (e.g. "..%2f.." decoded by Express).
const SAFE_ID = /^[a-z0-9-]+$/;
const safe = id => {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) {
    throw new Error(`invalid id: ${id}`);
  }
  return id;
};

const dir = id => path.join(root, safe(id));
const jsonPath = id => path.join(dir(id), 'pokemon.json');

function list() {
  return fs.readdirSync(root)
    .filter(id => {
      if (!SAFE_ID.test(id)) { console.warn(`skipping stray entry ${id}`); return false; }
      return true;
    })
    .filter(id => fs.existsSync(jsonPath(id)))
    .map(id => {
      try { return JSON.parse(fs.readFileSync(jsonPath(id), 'utf8')); }
      catch (e) { console.warn(`skipping unreadable ${id}: ${e.message}`); return null; }
    })
    .filter(Boolean)
    .sort((a, b) => a.number - b.number);
}

function get(id) {
  try { return JSON.parse(fs.readFileSync(jsonPath(id), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

function create(record) {
  const number = allocDex();
  const slug = slugify(record.stages[0].name) || 'pokemon';
  const id = `${slug}-${Date.now().toString(36)}`;
  const full = { id, number, createdAt: new Date().toISOString(), ...record };
  full.stages[0].number = allocCollector(); // per-stage global collector number
  fs.mkdirSync(dir(id), { recursive: true });
  return save(full);
}

// Per-stage collector numbers: one global sequence across every live stage.
// List-derived; used only by migrateNumbers() (init-time stamping) and the
// existing per-stage-numbers test. Live allocation goes through allocCollector().
function nextNumber() {
  return list().reduce((m, r) =>
    r.stages.reduce((m2, s) => Math.max(m2, s.number || 0), m), 0) + 1;
}

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

// Stamp a number on any stage missing one, walking records in list() order
// (record.number ascending) and stages in index order. Idempotent: stamped
// stages are never touched, so reruns and rescued archive records are safe.
function migrateNumbers() {
  let next = nextNumber();
  for (const rec of list()) {
    let dirty = false;
    for (const s of rec.stages) {
      if (s.number === undefined) { s.number = next++; dirty = true; }
    }
    if (dirty) save(rec);
  }
}

function save(record) {
  const target = jsonPath(record.id);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
  fs.renameSync(tmp, target);
  return record;
}

function saveArt(id, filename, buffer) {
  fs.writeFileSync(path.join(dir(id), filename), buffer);
  return filename;
}

function readArt(id, filename) {
  return fs.readFileSync(path.join(dir(id), filename));
}

function backupArt(id, filename) {
  const src = path.join(dir(id), filename);
  if (!fs.existsSync(src)) return;
  const backup = filename.replace(/(\.[a-z]+)$/, '.v1$1');
  fs.copyFileSync(src, path.join(dir(id), backup));
}

// Rename the live dir to follow a stage-0 name edit. Keeps the timestamp suffix
// (creation identity); only the slug prefix changes. Sanitized via slugify.
function renameFor(id, newName) {
  const suffix = id.slice(id.lastIndexOf('-') + 1);
  const newId = `${slugify(newName) || 'pokemon'}-${suffix}`;
  if (newId === id) return id;
  fs.renameSync(dir(id), dir(newId));
  return newId;
}

// Soft delete: move the folder out of the live root into a hidden sibling archive.
function archive(id) {
  const dest = path.join(root, '..', 'archive');
  fs.mkdirSync(dest, { recursive: true });
  fs.renameSync(dir(id), path.join(dest, id));
}

// ---------- trainers ----------
// <DATA_DIR>/trainers/<slug>/trainer.json + an avatar.<ext> image file.

const trainerDir = slug => path.join(trainersDir, safe(slug));

function trainersList() {
  return fs.readdirSync(trainersDir)
    .filter(slug => {
      if (!SAFE_ID.test(slug)) { console.warn(`skipping stray entry ${slug}`); return false; }
      return true;
    })
    .filter(slug => fs.existsSync(path.join(trainerDir(slug), 'trainer.json')))
    .map(slug => {
      try {
        const t = JSON.parse(fs.readFileSync(path.join(trainerDir(slug), 'trainer.json'), 'utf8'));
        const avatar = fs.readdirSync(trainerDir(slug)).find(f => f.startsWith('avatar.')) || null;
        return { slug, name: t.name, description: t.description, avatar, createdAt: t.createdAt };
      } catch (e) { console.warn(`skipping unreadable trainer ${slug}: ${e.message}`); return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

function trainerCreate({ name, description }) {
  let slug = slugify(name) || 'trainer';
  if (fs.existsSync(trainerDir(slug))) slug = `${slug}-${Date.now().toString(36)}`;
  const trainer = { name, description: description || '', createdAt: new Date().toISOString() };
  fs.mkdirSync(trainerDir(slug), { recursive: true });
  fs.writeFileSync(path.join(trainerDir(slug), 'trainer.json'), JSON.stringify(trainer, null, 2));
  return { slug, ...trainer };
}

function trainerSaveAvatar(slug, filename, buffer) {
  fs.writeFileSync(path.join(trainerDir(slug), filename), buffer);
  return filename;
}

function trainerGet(slug) {
  let t;
  try { t = JSON.parse(fs.readFileSync(path.join(trainerDir(slug), 'trainer.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const avatar = fs.readdirSync(trainerDir(slug)).find(f => f.startsWith('avatar.')) || null;
  return { slug, ...t, avatar };
}

function trainerSave(slug, trainer) {
  const { slug: _s, avatar: _a, ...data } = trainer; // slug/avatar are derived, not stored
  fs.writeFileSync(path.join(trainerDir(slug), 'trainer.json'), JSON.stringify(data, null, 2));
  return trainer;
}

// Same soft-delete pattern as pokemon: move into a hidden sibling archive.
function trainerArchive(slug) {
  const dest = path.join(trainersDir, '..', 'trainers-archive');
  fs.mkdirSync(dest, { recursive: true });
  fs.renameSync(trainerDir(slug), path.join(dest, `${slug}-${Date.now().toString(36)}`));
}

module.exports = {
  init, list, get, create, save, saveArt, readArt, backupArt, archive, nextNumber, migrateNumbers, renameFor, root: () => root,
  allocCollector,
  trainersList, trainerCreate, trainerSaveAvatar, trainerGet, trainerSave, trainerArchive,
  trainersRoot: () => trainersDir,
};
