const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let config = { providers: [], default: 'gemini' };
const LOADING_MSGS = window.LOADING_MSGS || ['Catching wild pixels...'];

// ---------- helpers ----------

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

let msgTimer;
function showLoading() {
  let i = Math.floor(Math.random() * LOADING_MSGS.length); // random start = variety each time
  $('#loading-msg').textContent = LOADING_MSGS[i];
  $('#loading').classList.remove('hidden');
  msgTimer = setInterval(() => {
    $('#loading-msg').textContent = LOADING_MSGS[++i % LOADING_MSGS.length];
  }, 3000);
}
function hideLoading() {
  $('#loading').classList.add('hidden');
  clearInterval(msgTimer);
}

// server-tracked cost badge: "<session images> pics ~ $<session cost> | all-time $<total>"
function updateCostBadge() {
  const c = config.cost;
  if (!c) return;
  $('#cost').textContent = c.session.images
    ? `${c.session.images} pics ~ $${c.session.cost.toFixed(2)} | all-time $${c.total.cost.toFixed(2)}`
    : `all-time $${c.total.cost.toFixed(2)}`;
}

// wraps an image-generating action with loading UI; cost is tracked server-side
async function generating(fn) {
  showLoading();
  try {
    const result = await fn();
    config = await api('/config').catch(() => config);
    updateCostBadge();
    return result;
  } catch (e) {
    alert(e.message);
    return null;
  } finally {
    hideLoading();
  }
}

function currentProvider() {
  return localStorage.provider || config.default;
}

const friendlyDate = iso => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
};

// localStorage.trainer holds the current trainer name; trainerAvatar its picture (for the nav chip)
function becomeTrainer(name, avatar) {
  localStorage.trainer = name;
  if (avatar) localStorage.trainerAvatar = avatar; else localStorage.removeItem('trainerAvatar');
}

function updateTrainerChip() {
  const chip = $('#trainer-chip');
  if (!chip) return;
  const name = localStorage.trainer;
  chip.classList.remove('hidden');
  chip.innerHTML = name
    ? `${localStorage.trainerAvatar ? `<img src="${localStorage.trainerAvatar}" alt="">` : ''}<span>${esc(name)}</span>`
    : '<span>Choose trainer</span>';
}

// Client-side label overrides. zai is off until the account has balance; flip back when funded.
const PROVIDER_LABELS = { zai: 'zai (off)' };

function providerLabel(p) {
  if (p.name === 'bridge') return config.bridge?.driverConnected ? 'bridge' : 'bridge (driver offline)';
  if (PROVIDER_LABELS[p.name]) return PROVIDER_LABELS[p.name];
  return `${p.name}${p.real ? '' : ' (soon)'}`;
}

function providerSelect() {
  return `<label class="provider no-print">art by
    <select id="provider">${config.providers.map(p =>
      `<option value="${p.name}" ${p.name === currentProvider() ? 'selected' : ''}>
        ${providerLabel(p)}</option>`).join('')}
    </select></label>`;
}

function updateBridgeHint() {
  const hint = $('#bridge-hint');
  if (!hint) return;
  const offline = currentProvider() === 'bridge' && !config.bridge?.driverConnected;
  hint.classList.toggle('hidden', !offline);
}

function bindProviderSelect() {
  const sel = $('#provider');
  if (sel) sel.onchange = () => { localStorage.provider = sel.value; updateBridgeHint(); };
}

function openLightbox(src) {
  const ov = document.createElement('div');
  ov.className = 'lightbox';
  ov.innerHTML = `<img src="${src}" alt="">`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  ov.onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}

// ---------- card ----------

function cardHTML(rec, idx) {
  const s = rec.stages[idx];
  const type = (s.types?.[0] || 'normal').toLowerCase();
  return `
  <div class="card type-${esc(type)}">
    <div class="card-head">
      <span class="card-name" contenteditable data-field="name">${esc(s.name)}</span>
      <span class="card-hp">HP <span contenteditable data-field="hp">${esc(s.hp)}</span></span>
      <span class="type-badge">${esc((s.types || []).join('/'))}</span>
    </div>
    <div class="card-art"><img src="/media/${rec.id}/${s.art}?v=${Date.now()}" alt="${esc(s.name)}"></div>
    <div class="card-category">${esc(s.category)} - Stage ${idx + 1}</div>
    <div class="card-moves">
      ${(s.moves || []).map((m, mi) => `
      <div class="move">
        <b contenteditable data-move="${mi}" data-field="name">${esc(m.name)}</b>
        <span class="dmg" contenteditable data-move="${mi}" data-field="damage">${esc(m.damage)}</span>
        <p contenteditable data-move="${mi}" data-field="text">${esc(m.text)}</p>
      </div>`).join('')}
    </div>
    <div class="card-flavor" contenteditable data-field="flavor">${esc(s.flavor)}</div>
    <div class="card-foot">#${String(rec.number).padStart(3, '0')}</div>
  </div>`;
}

// ---------- views ----------

function viewCreate() {
  $('#view').innerHTML = `
    <div class="create">
      <div class="create-stage lattice">
        <img class="create-logo" src="logo.jpg" alt="Pokemine">
        <p class="create-tag">Dream it up. We'll make the card.</p>
      </div>
      <div class="create-body">
        <textarea id="prompt" rows="3" placeholder="A butt Pokemon named Gyatt..."></textarea>
        <button id="go" class="big">Generate!</button>
        ${providerSelect()}
        <p id="bridge-hint" class="bridge-hint no-print hidden">Open gemini.google.com in Brave with the Pokemine Bridge extension</p>
      </div>
    </div>`;
  bindProviderSelect();
  updateBridgeHint();
  $('#go').onclick = async () => {
    const prompt = $('#prompt').value;
    if (!prompt.trim()) return;
    const rec = await generating(() =>
      api('/pokemon', { method: 'POST', body: { prompt, provider: currentProvider(), trainer: localStorage.trainer } }));
    if (rec) location.hash = `#card/${rec.id}`;
  };
}

async function viewCard(id, stageIdx) {
  const rec = await api(`/pokemon/${id}`);
  const idx = Math.min(stageIdx ?? rec.stages.length - 1, rec.stages.length - 1);
  $('#view').innerHTML = `
    <div class="card-page">
      <div class="stage-tabs">${rec.stages.map((s, i) =>
        `<button class="tab ${i === idx ? 'on' : ''}" onclick="location.hash='#card/${rec.id}/${i}'">
          ${esc(s.name)}</button>`).join('')}</div>
      <div class="card-row">
        ${cardHTML(rec, idx)}
        <div class="side">
          <div class="hint">Tap the card text to edit it!
            <button id="toggle-editable" class="ghost-btn no-print">Highlight editable</button></div>
          <div class="actions idea-box">
            <label class="idea-label" for="alter-text">Type an idea, then pick a button (or leave it blank):</label>
            <input id="alter-text" placeholder="give it a hat... make it angry... turn it into a dragon...">
            <div class="idea-buttons">
              <button id="alter">Redraw</button>
              <button id="evolve" class="big">EVOLVE!</button>
            </div>
            ${providerSelect()}
          </div>
          ${rec.stages[0].prompt ? `<div class="born-from">Born from: "${esc(rec.stages[0].prompt)}"
            <button id="use-origin" class="link-btn">use it</button></div>` : ''}
          ${rec.createdBy ? `<div class="born-from byline">by ${esc(rec.createdBy)} on ${friendlyDate(rec.createdAt)}</div>` : ''}
          <details class="backstory" open><summary>Backstory</summary>
            <p contenteditable data-field="backstory">${esc(rec.backstory)}</p></details>
          <button id="release" class="release no-print">Release into the wild</button>
        </div>
      </div>
    </div>`;
  bindProviderSelect();

  // "Highlight editable": outline every editable field; state persists across cards
  const cardPage = $('.card-page');
  const toggle = $('#toggle-editable');
  const applyEditable = on => { cardPage.classList.toggle('show-editable', on); toggle.classList.toggle('on', on); };
  applyEditable(!!localStorage.showEditable);
  toggle.onclick = () => {
    const on = !cardPage.classList.contains('show-editable');
    if (on) localStorage.showEditable = '1'; else localStorage.removeItem('showEditable');
    applyEditable(on);
  };

  $('#evolve').onclick = async () => {
    const instruction = $('#alter-text').value; // optional: steer the evolution
    const r = await generating(() =>
      api(`/pokemon/${rec.id}/evolve`, { method: 'POST', body: { instruction, provider: currentProvider() } }));
    if (r) { $('#alter-text').value = ''; location.hash = `#card/${rec.id}/${r.stages.length - 1}`; }
  };

  const artImg = $('.card-art img');
  if (artImg) artImg.onclick = () => openLightbox(artImg.src);

  const useOrigin = $('#use-origin');
  if (useOrigin) useOrigin.onclick = () => { $('#alter-text').value = rec.stages[0].prompt; };

  $('#release').onclick = async () => {
    const name = rec.stages[idx].name;
    if (!confirm(`Release ${name} into the wild? (Dad can rescue them from the archive.)`)) return;
    await api(`/pokemon/${rec.id}`, { method: 'DELETE' }).catch(e => alert(e.message));
    location.hash = '#dex';
  };

  $('#alter').onclick = async () => {
    const instruction = $('#alter-text').value;
    const r = await generating(() =>
      api(`/pokemon/${rec.id}/alter`, {
        method: 'POST', body: { instruction, stage: idx, provider: currentProvider() },
      }));
    if (r) viewCard(rec.id, idx);
  };

  // inline edits: PATCH on blur
  document.querySelectorAll('[contenteditable]').forEach(el => {
    el.onblur = async () => {
      const field = el.dataset.field;
      let value = el.textContent.trim();
      const body = { stage: idx };
      if (el.dataset.move !== undefined) {
        const moves = structuredClone(rec.stages[idx].moves);
        const m = moves[+el.dataset.move];
        m[field] = field === 'damage' ? (parseInt(value) || m.damage) : value;
        body.moves = moves;
        rec.stages[idx].moves = moves;
      } else if (field === 'hp') {
        body.hp = parseInt(value) || rec.stages[idx].hp;
      } else if (field === 'backstory') {
        body.backstory = value;
      } else {
        body[field] = value;
      }
      await api(`/pokemon/${rec.id}`, { method: 'PATCH', body }).catch(e => alert(e.message));
    };
  });
}

async function viewDex() {
  const all = await api('/pokemon');
  const me = localStorage.trainer;
  // your Pokemon first, then other trainers', then legacy records with no owner
  const rank = r => (r.createdBy === me ? 0 : r.createdBy ? 1 : 2);
  const sorted = [...all].sort((a, b) => rank(a) - rank(b) || a.number - b.number);
  const tile = rec => {
    const s = rec.stages[rec.stages.length - 1];
    return `<a class="dex-item" href="#card/${rec.id}">
      <img src="/media/${rec.id}/${s.art}" alt="${esc(s.name)}">
      <div>#${String(rec.number).padStart(3, '0')} ${esc(s.name)}</div>
    </a>`;
  };
  const render = filter => {
    const list = filter === 'mine' ? sorted.filter(r => r.createdBy === me) : sorted;
    $('#dex-grid').innerHTML = list.map(tile).join('')
      || (filter === 'mine' ? '<p>None of these are yours yet. Go make one!</p>' : '<p>No Pokemon yet. Go make one!</p>');
    document.querySelectorAll('.dex-chip').forEach(c => c.classList.toggle('on', c.dataset.f === filter));
  };
  $('#view').innerHTML = `
    <h1 class="display">Your Pokedex (${all.length})</h1>
    <div class="dex-filters no-print">
      <button class="dex-chip on" data-f="all">All</button>
      <button class="dex-chip" data-f="mine">Mine</button>
    </div>
    <div id="dex-grid" class="dex"></div>`;
  document.querySelectorAll('.dex-chip').forEach(c => { c.onclick = () => render(c.dataset.f); });
  render('all');
}

async function viewTrainers() {
  const trainers = await api('/trainers');
  $('#view').innerHTML = `
    <h1 class="display">Choose Your Trainer</h1>
    <div class="trainer-grid">
      ${trainers.map(t => `
        <button class="trainer-card" data-name="${esc(t.name)}" data-avatar="${esc(t.avatar || '')}">
          <img src="${esc(t.avatar || '')}" alt="${esc(t.name)}">
          <span>${esc(t.name)}</span>
        </button>`).join('') || '<p class="no-trainers">No trainers yet - make the first one!</p>'}
    </div>
    <div class="new-trainer idea-box">
      <h2 class="display new-trainer-title">New Trainer</h2>
      <label class="idea-label" for="t-name">Trainer name</label>
      <input id="t-name" placeholder="Ash, Ellie, Captain Sock...">
      <label class="idea-label" for="t-desc">Describe your trainer (for the avatar)</label>
      <input id="t-desc" placeholder="a kid with a red cap, goggles, and a big grin...">
      ${providerSelect()}
      <button id="t-go" class="big">GO!</button>
    </div>`;
  bindProviderSelect();
  document.querySelectorAll('.trainer-card').forEach(b => {
    b.onclick = () => { becomeTrainer(b.dataset.name, b.dataset.avatar); location.hash = '#create'; };
  });
  $('#t-go').onclick = async () => {
    const name = $('#t-name').value.trim();
    const description = $('#t-desc').value.trim();
    if (!name) return;
    const t = await generating(() =>
      api('/trainers', { method: 'POST', body: { name, description, provider: currentProvider() } }));
    if (t) { becomeTrainer(t.name, t.avatar); location.hash = '#create'; }
  };
}

async function viewPrint() {
  const all = await api('/pokemon');
  const items = all.flatMap(rec => rec.stages.map((s, i) => ({ rec, i })));
  $('#view').innerHTML = `
    <div class="no-print print-bar">
      <h1 class="display">Print Cards</h1>
      <p>Untick any card you don't want, then hit print. Cards come out real size (63x88mm) - cut inside the yellow border.</p>
      <button id="do-print" class="big">PRINT!</button>
    </div>
    <div class="print-grid">${items.map(({ rec, i }, n) => `
      <div class="print-item">
        <label class="no-print"><input type="checkbox" checked data-n="${n}"> include</label>
        ${cardHTML(rec, i)}
      </div>`).join('') || '<p>No Pokemon yet. Go make one!</p>'}</div>`;
  $('#do-print').onclick = () => window.print();
  document.querySelectorAll('.print-item input[type=checkbox]').forEach(cb => {
    cb.onchange = () => cb.closest('.print-item').classList.toggle('skip', !cb.checked);
  });
  // print view is read-only: kill the inline editors cardHTML sets up
  document.querySelectorAll('.print-grid [contenteditable]').forEach(el =>
    el.removeAttribute('contenteditable'));
}

// ---------- router ----------

async function route() {
  try { config = await api('/config'); } catch { /* keep last-known config */ }
  updateCostBadge();
  const [view, id, extra] = location.hash.slice(1).split('/');
  document.body.dataset.view = view || 'create';
  // must pick a trainer before doing anything else (help.html is a separate page, unaffected)
  if (!localStorage.trainer && view !== 'trainers') { location.hash = '#trainers'; return; }
  updateTrainerChip();
  try {
    if (view === 'trainers') return await viewTrainers();
    if (view === 'card' && id) return await viewCard(id, extra === undefined ? undefined : +extra);
    if (view === 'dex') return await viewDex();
    if (view === 'print') return await viewPrint();
    return viewCreate();
  } catch (e) {
    $('#view').innerHTML = `<h1>Uh oh!</h1><p>${esc(e.message)}</p>`;
  }
}

window.addEventListener('hashchange', route);

route(); // route() fetches config before rendering
