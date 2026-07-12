const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let config = { providers: [], default: 'gemini' };
const session = { images: 0, cost: 0 };
const COST = { gemini: 0.034 };
const LOADING_MSGS = [
  'Catching wild pixels...', 'Shaking the Pokeball...', 'Professor Oak is sketching...',
  'Mixing up silly DNA...', 'Teaching it its first move...', 'Almost hatched...',
];

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
  let i = 0;
  $('#loading-msg').textContent = LOADING_MSGS[0];
  $('#loading').classList.remove('hidden');
  msgTimer = setInterval(() => {
    $('#loading-msg').textContent = LOADING_MSGS[++i % LOADING_MSGS.length];
  }, 3000);
}
function hideLoading() {
  $('#loading').classList.add('hidden');
  clearInterval(msgTimer);
}

// wraps an image-generating action with loading UI + cost tracking
async function generating(fn) {
  showLoading();
  try {
    const result = await fn();
    session.images++;
    session.cost += COST[currentProvider()] || 0;
    $('#cost').textContent = `${session.images} pics ~ $${session.cost.toFixed(2)}`;
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

function providerLabel(p) {
  if (p.name === 'bridge') return config.bridge?.driverConnected ? 'bridge' : 'bridge (driver offline)';
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
      api('/pokemon', { method: 'POST', body: { prompt, provider: currentProvider() } }));
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
          <div class="hint">Tap the card text to edit it!</div>
          <div class="actions">
            <input id="alter-text" placeholder="Change it! (give it a hat...)">
            <button id="alter">Redraw</button>
            <button id="evolve" class="big">EVOLVE!</button>
            ${providerSelect()}
          </div>
          <details class="backstory" open><summary>Backstory</summary>
            <p contenteditable data-field="backstory">${esc(rec.backstory)}</p></details>
        </div>
      </div>
    </div>`;
  bindProviderSelect();

  $('#evolve').onclick = async () => {
    const r = await generating(() =>
      api(`/pokemon/${rec.id}/evolve`, { method: 'POST', body: { provider: currentProvider() } }));
    if (r) location.hash = `#card/${rec.id}/${r.stages.length - 1}`;
  };

  $('#alter').onclick = async () => {
    const instruction = $('#alter-text').value;
    if (!instruction.trim()) return;
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
  $('#view').innerHTML = `
    <h1 class="display">Your Pokedex (${all.length})</h1>
    <div class="dex">${all.map(rec => {
      const s = rec.stages[rec.stages.length - 1];
      return `<a class="dex-item" href="#card/${rec.id}">
        <img src="/media/${rec.id}/${s.art}" alt="${esc(s.name)}">
        <div>#${String(rec.number).padStart(3, '0')} ${esc(s.name)}</div>
      </a>`;
    }).join('') || '<p>No Pokemon yet. Go make one!</p>'}</div>`;
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
  const [view, id, extra] = location.hash.slice(1).split('/');
  try {
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
