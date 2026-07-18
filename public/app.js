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
  lastBall = ''; // each generation's first phase avoids the initial red Poke Ball
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

function showError(msg) {
  const { title, body } = window.friendlyError(msg);
  $('#error-box-title').textContent = title;
  $('#error-box-body').textContent = body;
  $('#error-box').classList.remove('hidden');
}

// Random ball per phase for variety. '' = red Poke Ball; the do-while guarantees
// a visible swap between phases (and off the initial red) rather than a repeat.
// The ball swap IS the phase signal - random loading lines keep scrolling throughout.
const BALLS = ['', 'great', 'ultra', 'master'];
const MIN_PHASE_MS = 600; // hold each phase visible so fast/mock art doesn't flash by
let lastBall = '', phaseShownAt = 0;

function setPhase() {
  let ball;
  do { ball = BALLS[Math.floor(Math.random() * BALLS.length)]; }
  while (ball === lastBall);
  lastBall = ball;
  phaseShownAt = Date.now();
  $('#loading .pokeball').className = 'pokeball' + (ball ? ' ' + ball : '');
}

// Read an SSE stream: swap balls on phase events, surface errors, return the done payload.
async function streamSSE(res) {
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Something went wrong'); }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', result, errMsg;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
      let evt = 'message', data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) evt = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (evt === 'phase') setPhase();
      else if (evt === 'done') result = JSON.parse(data);
      else if (evt === 'error') errMsg = JSON.parse(data).message;
    }
  }
  if (errMsg) throw new Error(errMsg);
  return result;
}

// Hold the final ball visible long enough to register, even when art is instant (mock/zai).
function holdFinalPhase() {
  if (!phaseShownAt) return Promise.resolve();
  const left = MIN_PHASE_MS - (Date.now() - phaseShownAt);
  return left > 0 ? new Promise(r => setTimeout(r, left)) : Promise.resolve();
}

async function createPokemon(prompt, provider, trainer, textProvider) {
  const res = await fetch('/api/pokemon', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, provider, trainer, textProvider }),
  });
  const data = await streamSSE(res);
  await holdFinalPhase();
  return data;
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
    showError(e.message);
    return null;
  } finally {
    hideLoading();
  }
}

function currentProvider() {
  return localStorage.provider || config.default;
}

function currentTextProvider() {
  return localStorage.textProvider || config.textProvider || 'gemini';
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

function textProviderSelect() {
  const opts = (config.textProviders || []).map(p =>
    `<option value="${p}" ${p === currentTextProvider() ? 'selected' : ''}>${p}</option>`).join('');
  return `<label class="provider no-print">words by
    <select id="text-provider">${opts}</select></label>`;
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

const VARIANT_LABELS = { VMAX: 'VMAX', EX: 'EX', Mega: 'MEGA' };

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
  <div class="card type-${esc(type)} stage-${tier}${s.variant ? ` variant-${s.variant.toLowerCase()}` : ''}">
    ${evoBadge}
    <div class="card-top">
      <div class="card-eyebrow-row">
        <div class="card-eyebrow">${eyebrow}</div>
        <span class="type-badge">${esc((s.types || []).join('/'))}</span>
      </div>
      <div class="card-head">
        <span class="card-name">${s.variant === 'Mega'
          ? `<span class="variant-label">MEGA </span><span contenteditable data-field="name">${esc(s.name)}</span>`
          : `<span contenteditable data-field="name">${esc(s.name)}</span>${s.variant ? `<span class="variant-label"> ${VARIANT_LABELS[s.variant]}</span>` : ''}`}</span>
        <span class="card-hp"><span contenteditable data-field="hp">${esc(s.hp)}</span> HP</span>
      </div>
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
    <div class="card-foot"><span class="foot-brand">Pokémine</span><span class="foot-no">#${String(s.number ?? rec.number).padStart(4, '0')}</span></div>
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
        ${config.textProviders && config.textProviders.length > 1 ? textProviderSelect() : ''}
        <p id="bridge-hint" class="bridge-hint no-print hidden">Open gemini.google.com in Brave with the Pokemine Bridge extension</p>
      </div>
    </div>`;
  bindProviderSelect();
  const tsel = $('#text-provider');
  if (tsel) tsel.onchange = () => { localStorage.textProvider = tsel.value; };
  updateBridgeHint();
  $('#go').onclick = async () => {
    const prompt = $('#prompt').value;
    if (!prompt.trim()) return;
    showLoading();
    try {
      const { record, warning } = await createPokemon(prompt, currentProvider(), localStorage.trainer, currentTextProvider());
      config = await api('/config').catch(() => config);
      updateCostBadge();
      location.hash = `#card/${record.id}`;
      if (warning) showError('art-failed'); // card saved with placeholder; nudge a Redraw
    } catch (e) {
      showError(e.message);
    } finally {
      hideLoading();
    }
  };
}

async function viewCard(id, stageIdx) {
  const rec = await api(`/pokemon/${id}`);
  const idx = Math.min(stageIdx ?? rec.stages.length - 1, rec.stages.length - 1);
  // per-stage Born from: the kid's own words for this stage ('' for an unguided
  // evolution - the eyebrow's "Evolves from X" covers it; 'evolved' is the legacy sentinel)
  const bornFrom = rec.stages[idx].prompt && rec.stages[idx].prompt !== 'evolved'
    ? rec.stages[idx].prompt : '';
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
            <p contenteditable data-field="backstory">${esc(rec.stages[idx].backstory ?? rec.backstory)}</p></details>
          <div class="actions idea-box">
            <label class="idea-label" for="alter-text">Type an idea, then pick a button (or leave it blank):</label>
            <textarea id="alter-text" rows="2" placeholder="give it a hat... make it angry... turn it into a dragon..."></textarea>
            <div class="idea-buttons">
              <button id="alter">Redraw</button>
              ${rec.stages.length >= 3
                ? '<span class="fully-evolved" role="status">🌟 Fully evolved!</span>'
                : '<button id="evolve" class="big">EVOLVE!</button>'}
            </div>
            ${providerSelect()}
          </div>
          ${bornFrom ? `<div class="born-from">Born from: "${esc(bornFrom)}"
            <button id="use-origin" class="link-btn">use it</button></div>` : ''}
          ${rec.createdBy ? `<div class="born-from byline">by ${esc(rec.createdBy)} on ${friendlyDate(rec.createdAt)}</div>` : ''}
          <button id="release" class="release no-print">Release into the wild</button>
        </div>
      </div>
    </div>`;
  bindProviderSelect();

  // Idea box grows with typing, always keeping one blank line of breathing room;
  // caps at ~8 lines, after which it scrolls.
  const idea = $('#alter-text');
  const growIdea = () => {
    idea.style.height = 'auto';
    const line = parseFloat(getComputedStyle(idea).lineHeight) || 20;
    idea.style.height = `${Math.min(idea.scrollHeight + line, line * 8)}px`;
  };
  idea.oninput = growIdea;
  growIdea();

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
    const r = await generating(async () => {
      const res = await fetch(`/api/pokemon/${rec.id}/evolve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, provider: currentProvider() }),
      });
      const data = await streamSSE(res);
      await holdFinalPhase();
      return data.record;
    });
    if (r) { $('#alter-text').value = ''; location.hash = `#card/${rec.id}/${r.stages.length - 1}`; }
  };

  const artImg = $('.card-art img');
  if (artImg) artImg.onclick = () => openLightbox(artImg.src);

  const useOrigin = $('#use-origin');
  if (useOrigin) useOrigin.onclick = () => { $('#alter-text').value = bornFrom; };

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
      const updated = await api(`/pokemon/${rec.id}`, { method: 'PATCH', body }).catch(e => alert(e.message));
      if (updated && updated.id !== rec.id) location.hash = `#card/${updated.id}/${idx}`; // dir renamed to follow the stage-0 name
    };
  });
}

async function viewDex() {
  const all = await api('/pokemon');
  const me = localStorage.trainer;
  // one tile per stage, A1,A2,A3,B1...: alphabetical by stage-1 name, then stage
  const items = all.flatMap(rec => rec.stages.map((s, i) => ({ rec, s, i })))
    .sort((a, b) => a.rec.stages[0].name.localeCompare(b.rec.stages[0].name)
      || (a.rec.stages[0].number ?? 0) - (b.rec.stages[0].number ?? 0)
      || a.i - b.i);
  const tile = ({ rec, s, i }) => `<a class="dex-item" href="#card/${rec.id}/${i}">
      ${s.variant ? `<span class="dex-variant dv-${s.variant.toLowerCase()}">${VARIANT_LABELS[s.variant]}</span>` : ''}
      <img src="/media/${rec.id}/${s.art}" alt="${esc(s.name)}">
      <div>#${String(s.number ?? rec.number).padStart(4, '0')} ${esc(s.name)}</div>
    </a>`;
  const render = filter => {
    const list = filter === 'mine' ? items.filter(x => x.rec.createdBy === me) : items;
    $('#dex-grid').innerHTML = list.map(tile).join('')
      || (filter === 'mine' ? '<p>None of these are yours yet. Go make one!</p>' : '<p>No Pokemon yet. Go make one!</p>');
    document.querySelectorAll('.dex-chip').forEach(c => c.classList.toggle('on', c.dataset.f === filter));
  };
  $('#view').innerHTML = `
    <h1 class="display">Your Pokedex (${items.length})</h1>
    <div class="dex-filters no-print">
      <button class="dex-chip on" data-f="all">All</button>
      <button class="dex-chip" data-f="mine">Mine</button>
    </div>
    <div id="dex-grid" class="dex"></div>`;
  document.querySelectorAll('.dex-chip').forEach(c => { c.onclick = () => { localStorage.dexFilter = c.dataset.f; render(c.dataset.f); }; });
  render(localStorage.dexFilter === 'mine' ? 'mine' : 'all'); // remember last filter per browser
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

const errorOk = $('#error-box-ok');
if (errorOk) errorOk.onclick = () => $('#error-box').classList.add('hidden');

route(); // route() fetches config before rendering
