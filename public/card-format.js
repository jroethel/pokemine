// Pure formatting helpers for cards/labels. No DOM refs, so unit-testable in node.
// providerLabel reads the global `config` (declared in app.js) only on its bridge branch;
// the tests skip that path, so every other call is self-contained here.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const friendlyDate = iso => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
};

// Client-side label overrides. zai is off until the account has balance; flip back when funded.
const PROVIDER_LABELS = { zai: 'zai (off)' };

function providerLabel(p) {
  if (p.name === 'bridge') return config.bridge?.driverConnected ? 'bridge' : 'bridge (driver offline)';
  if (PROVIDER_LABELS[p.name]) return PROVIDER_LABELS[p.name];
  return `${p.name}${p.real ? '' : ' (soon)'}`;
}

const VARIANT_LABELS = { VMAX: 'VMAX', EX: 'EX', Mega: 'MEGA' };

// Evolution eyebrow: "Basic Pokemon" or "Stage N · Evolves from <prev>" (TCG: 2nd form = Stage 1).
function stageLabel(rec, idx) {
  return idx === 0
    ? 'Basic Pokémon'
    : `Stage ${idx} · Evolves from ${esc(rec.stages[idx - 1].name)}`;
}

// Poke Ball per phase for variety; '' = the red Poke Ball (app.js's setPhase picks from this).
const BALLS = ['', 'great', 'ultra', 'master'];

if (typeof module !== 'undefined') module.exports = { esc, friendlyDate, providerLabel, PROVIDER_LABELS, VARIANT_LABELS, stageLabel, BALLS };
if (typeof window !== 'undefined') Object.assign(window, { esc, friendlyDate, providerLabel, PROVIDER_LABELS, VARIANT_LABELS, stageLabel, BALLS });
