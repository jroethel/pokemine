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

// localStorage.trainer holds the current trainer NAME (used for createdBy + the "Mine" dex
// filter, so it stays the name, not the slug); trainerAvatar its picture (for the nav chip).
// The profile fetch needs the slug - resolved from the trainers list by name at call time,
// so there is one source of truth and no stale slug to migrate. (Same-name trainers: the
// first match wins - acceptable for a family app.)
function becomeTrainer(name, avatar) {
  localStorage.trainer = name;
  if (avatar) localStorage.trainerAvatar = avatar; else localStorage.removeItem('trainerAvatar');
}

function clearTrainer() {
  localStorage.removeItem('trainer');
  localStorage.removeItem('trainerAvatar');
}

function updateTrainerChip() {
  const chip = $('#trainer-chip');
  if (!chip) return;
  const name = localStorage.trainer;
  chip.innerHTML = name
    ? `${localStorage.trainerAvatar ? `<img src="${localStorage.trainerAvatar}" alt="">` : ''}<span>${esc(name)}</span>`
    : '<span>Trainer</span>';
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
  // top-left eyebrow like a real Base Set card: "Basic" or "Stage N · Evolves from <prev>"
  const eyebrow = idx === 0
    ? 'Basic Pokémon'
    : `Stage ${idx} · Evolves from ${esc(rec.stages[idx - 1].name)}`; // TCG convention: 2nd form = Stage 1
  // frame flourish scales with evolution stage (Basic -> Stage 1 -> fully-evolved EX)
  const tier = Math.min(idx + 1, 3);
  const evoBadge = idx > 0
    ? `<img class="evo-badge" src="/media/${rec.id}/${esc(rec.stages[idx - 1].art)}?v=${Date.now()}" alt="Evolves from ${esc(rec.stages[idx - 1].name)}">`
    : '';
  return `
  <div class="card type-${esc(type)} stage-${tier}">
    ${evoBadge}
    <div class="card-eyebrow">${eyebrow}</div>
    <div class="card-head">
      <span class="card-name" contenteditable data-field="name">${esc(s.name)}</span>
      <span class="card-hp"><span contenteditable data-field="hp">${esc(s.hp)}</span> HP</span>
      <span class="type-badge">${esc((s.types || []).join('/'))}</span>
    </div>
    <div class="card-art"><img src="/media/${rec.id}/${s.art}?v=${Date.now()}" alt="${esc(s.name)}"></div>
    <div class="card-category" contenteditable data-field="category">${esc(s.category)}</div>
    <div class="card-moves">
      ${(s.moves || []).map((m, mi) => `
      <div class="move">
        <b contenteditable data-move="${mi}" data-field="name">${esc(m.name)}</b>
        <span class="dmg" contenteditable data-move="${mi}" data-field="damage">${esc(m.damage)}</span>
        <p contenteditable data-move="${mi}" data-field="text">${esc(m.text)}</p>
      </div>`).join('')}
    </div>
    <div class="card-flavor" contenteditable data-field="flavor">${esc(s.flavor)}</div>
    <div class="card-foot"><span class="foot-brand">Pokémine</span><span class="foot-no">#${String(rec.number).padStart(3, '0')}</span></div>
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
        ${localStorage.trainer
          ? `<p class="create-nudge">${localStorage.trainerAvatar ? `<img src="${esc(localStorage.trainerAvatar)}" alt="">` : ''}Playing as <b>${esc(localStorage.trainer)}</b><a href="#trainers" class="profile-link">profile</a></p>`
          : `<p class="create-nudge none">No trainer picked - <a href="#trainers">choose or make one</a></p>`}
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
          <details class="backstory" open><summary>Backstory</summary>
            <p contenteditable data-field="backstory">${esc(rec.backstory)}</p></details>
          <div class="actions idea-box">
            <label class="idea-label" for="alter-text">Type an idea, then pick a button (or leave it blank):</label>
            <input id="alter-text" placeholder="give it a hat... make it angry... turn it into a dragon...">
            <div class="idea-buttons">
              <button id="alter">Redraw</button>
              ${rec.stages.length >= 3
                ? '<span class="fully-evolved" role="status">🌟 Fully evolved!</span>'
                : '<button id="evolve" class="big">EVOLVE!</button>'}
            </div>
            ${providerSelect()}
          </div>
          ${rec.stages[0].prompt ? `<div class="born-from">Born from: "${esc(rec.stages[0].prompt)}"
            <button id="use-origin" class="link-btn">use it</button></div>` : ''}
          ${rec.createdBy ? `<div class="born-from byline">by ${esc(rec.createdBy)} on ${friendlyDate(rec.createdAt)}</div>` : ''}
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

  const evolveBtn = $('#evolve'); // absent once fully evolved (3 stages)
  if (evolveBtn) evolveBtn.onclick = async () => {
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

// the top-of-page marquee for the active trainer; p is a full profile (GET /trainers/:slug)
function marqueeHTML(p) {
  return `
    <div class="marquee-avatar">${p.avatar
      ? `<img src="${esc(p.avatar)}" alt="${esc(p.name)}">`
      : '<div class="marquee-avatar-none">?</div>'}</div>
    <div class="marquee-info">
      <h1 class="display marquee-name">${esc(p.name)}</h1>
      ${p.region || p.homeGym || p.favoritePokemon || p.finishingMove ? `<div class="marquee-meta">
        ${p.region ? `<span class="meta-pill"><b>Region</b> ${esc(p.region)}</span>` : ''}
        ${p.homeGym ? `<span class="meta-pill"><b>Home Gym</b> ${esc(p.homeGym)}</span>` : ''}
        ${p.favoritePokemon ? `<span class="meta-pill"><b>Favorite Pokemon</b> ${esc(p.favoritePokemon)}</span>` : ''}
        ${p.finishingMove ? `<span class="meta-pill"><b>Finishing Move</b> ${esc(p.finishingMove)}</span>` : ''}
      </div>` : ''}
      ${p.backstory ? `<p class="marquee-backstory">${esc(p.backstory)}</p>` : ''}
      ${p.description ? `<p class="marquee-prompt">Dreamed up as: "${esc(p.description)}"</p>` : ''}
      <div class="marquee-actions">
        <button id="take-break" class="take-break">Take a break</button>
        <button id="archive-trainer" class="release">Join Team Rocket</button>
      </div>
    </div>`;
}

function noTrainerMarqueeHTML() {
  return `<div class="marquee-empty">
    <div class="marquee-avatar-none">?</div>
    <div>
      <h1 class="display marquee-name">No trainer picked</h1>
      <p class="marquee-empty-tip">Tap an avatar below to jump in, or make a brand-new trainer.
        You can browse and make Pokemon without one too!</p>
    </div>
  </div>`;
}

// Load the active trainer's full profile into the marquee. The GET can be slow (server
// backfills lore for pre-profile trainers), so show a loading state; degrade gracefully.
async function loadMarquee(trainers) {
  const el = $('#trainer-marquee');
  if (!el) return;
  const active = localStorage.trainer;
  const t = active && trainers.find(x => x.name === active);
  if (!t) { el.innerHTML = noTrainerMarqueeHTML(); el.classList.add('empty'); return; }
  el.classList.remove('empty');
  el.innerHTML = `<div class="marquee-loading"><span class="mini-ball"></span>
    <p>Loading ${esc(t.name)}'s profile...</p></div>`;
  let p;
  try { p = await api(`/trainers/${t.slug}`); }
  catch { p = { ...t }; } // show name + avatar we already have if lore gen fails
  if (!p.avatar) p.avatar = t.avatar;
  // guard against a stale load if the user switched trainers mid-fetch
  if (localStorage.trainer !== t.name) return;
  el.innerHTML = marqueeHTML(p);
  const img = el.querySelector('.marquee-avatar img');
  if (img) img.onclick = () => openLightbox(img.src);
  $('#take-break').onclick = () => {
    clearTrainer();
    updateTrainerChip();
    document.querySelectorAll('.trainer-card').forEach(c => c.classList.remove('on'));
    el.innerHTML = noTrainerMarqueeHTML();
    el.classList.add('empty');
  };
  $('#archive-trainer').onclick = async () => {
    if (!confirm(`Send ${p.name} off to Team Rocket? (Dad can always rescue them back.)`)) return;
    await api(`/trainers/${t.slug}/archive`, { method: 'POST' }).catch(e => alert(e.message));
    if (localStorage.trainer === p.name) { clearTrainer(); updateTrainerChip(); }
    viewTrainers(); // refresh the grid without the archived trainer
  };
}

async function viewTrainers() {
  const trainers = await api('/trainers');
  const active = localStorage.trainer;
  $('#view').innerHTML = `
    <section id="trainer-marquee" class="trainer-marquee"></section>
    <h2 class="display choose-title">Choose Your Trainer</h2>
    <div class="trainer-grid">
      ${trainers.map(t => `
        <button class="trainer-card ${t.name === active ? 'on' : ''}" data-slug="${esc(t.slug)}" data-name="${esc(t.name)}" data-avatar="${esc(t.avatar || '')}">
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
  // selecting an avatar stays on #trainers and loads that trainer into the marquee
  document.querySelectorAll('.trainer-card').forEach(b => {
    b.onclick = () => {
      becomeTrainer(b.dataset.name, b.dataset.avatar);
      updateTrainerChip();
      document.querySelectorAll('.trainer-card').forEach(c => c.classList.toggle('on', c === b));
      loadMarquee(trainers);
    };
  });
  $('#t-go').onclick = async () => {
    const name = $('#t-name').value.trim();
    const description = $('#t-desc').value.trim();
    if (!name) return;
    const t = await generating(() =>
      api('/trainers', { method: 'POST', body: { name, description, provider: currentProvider() } }));
    if (t) { becomeTrainer(t.name, t.avatar); updateTrainerChip(); viewTrainers(); }
  };
  loadMarquee(trainers);
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
  // nav brand is always the burst logo (set in index.html); no per-view swap
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
