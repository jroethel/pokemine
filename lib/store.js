const fs = require('fs');
const path = require('path');

let root;

function init(dataDir) {
  root = path.resolve(dataDir, 'pokemon');
  fs.mkdirSync(root, { recursive: true });
}

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

module.exports = { init, list, get, create, save, saveArt, readArt, backupArt, root: () => root };
