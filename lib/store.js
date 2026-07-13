const fs = require('fs');
const path = require('path');

let root, trainersDir;

function init(dataDir) {
  root = path.resolve(dataDir, 'pokemon');
  fs.mkdirSync(root, { recursive: true });
  trainersDir = path.resolve(dataDir, 'trainers');
  fs.mkdirSync(trainersDir, { recursive: true });
}

const slugify = s => (s || '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const dir = id => path.join(root, id);
const jsonPath = id => path.join(dir(id), 'pokemon.json');

function list() {
  return fs.readdirSync(root)
    .filter(id => fs.existsSync(jsonPath(id)))
    .map(id => JSON.parse(fs.readFileSync(jsonPath(id), 'utf8')))
    .sort((a, b) => a.number - b.number);
}

function get(id) {
  return JSON.parse(fs.readFileSync(jsonPath(id), 'utf8'));
}

function create(record) {
  const number = list().reduce((m, p) => Math.max(m, p.number), 0) + 1;
  const slug = (record.stages[0].name || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'pokemon';
  const id = `${slug}-${Date.now().toString(36)}`;
  const full = { id, number, createdAt: new Date().toISOString(), ...record };
  fs.mkdirSync(dir(id), { recursive: true });
  return save(full);
}

function save(record) {
  fs.writeFileSync(jsonPath(record.id), JSON.stringify(record, null, 2));
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

// Soft delete: move the folder out of the live root into a hidden sibling archive.
function archive(id) {
  const dest = path.join(root, '..', 'archive');
  fs.mkdirSync(dest, { recursive: true });
  fs.renameSync(dir(id), path.join(dest, id));
}

// ---------- trainers ----------
// <DATA_DIR>/trainers/<slug>/trainer.json + an avatar.<ext> image file.

const trainerDir = slug => path.join(trainersDir, slug);

function trainersList() {
  return fs.readdirSync(trainersDir)
    .filter(slug => fs.existsSync(path.join(trainerDir(slug), 'trainer.json')))
    .map(slug => {
      const t = JSON.parse(fs.readFileSync(path.join(trainerDir(slug), 'trainer.json'), 'utf8'));
      const avatar = fs.readdirSync(trainerDir(slug)).find(f => f.startsWith('avatar.')) || null;
      return { slug, name: t.name, description: t.description, avatar, createdAt: t.createdAt };
    })
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

module.exports = {
  init, list, get, create, save, saveArt, readArt, backupArt, archive, root: () => root,
  trainersList, trainerCreate, trainerSaveAvatar, trainersRoot: () => trainersDir,
};
