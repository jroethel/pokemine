const fs = require('fs');
const { getTextProvider } = require('./text-providers');

const URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

const SYSTEM = `You invent silly Pokemon-style creatures for a kid aged 8-12.
Humor: silly and gross-out humor is great. Keep everything PG and kind.
Always answer with pure JSON only, no markdown fences.`;

// Append the universe canon (if CANON_FILE is set and exists) to the system prompt.
// Read lazily so tests can set CANON_FILE after requiring this module.
function buildSystem() {
  const file = process.env.CANON_FILE;
  if (file && fs.existsSync(file)) {
    return `${SYSTEM}\n\n## Universe canon\n${fs.readFileSync(file, 'utf8')}`;
  }
  return SYSTEM;
}

const ART_STYLE = 'Cel-shaded official Pokemon-style game art in the Ken Sugimori watercolor style: simple readable silhouette, bold slightly-varied outlines, 1-2 midtone main colors plus one accent, soft purple-tinted shadows, basic highlights, full body, single creature, plain white background. Do not write the creature\'s name or any text, letters, numbers, logos, or watermarks anywhere in the image.';

// Per-stage stat bands and the rare special tier for final evolutions.
// Tweak here: bands are [floor, ceiling]; odds are absolute (sum = 5%).
const STAGES = {
  hp:  { 1: [30, 120], 2: [60, 160], 3: [90, 200] },   // [floor, ceiling]
  dmg: { 1: [10, 60],  2: [30, 120], 3: [60, 200] },
  special: {
    odds: { VMAX: 0.05, EX: 0.03, Mega: 0.02 },      // absolute, sums to 10%; VMAX < EX < Mega
    variants: { // floors guarantee a special always out-stats a normal stage 3
      VMAX: { hpMin: 220, hpMax: 260, dmgMin: 220, dmgMax: 260, label: 'VMAX', art: 'crackling electric-blue energy, radiant silver aura, sparks flying' },
      EX:   { hpMin: 240, hpMax: 300, dmgMin: 240, dmgMax: 300, label: 'EX',   art: 'wreathed in golden fire, glowing prismatic divine radiance' },
      Mega: { hpMin: 260, hpMax: 340, dmgMin: 260, dmgMax: 340, label: 'MEGA', art: 'colossal mega-evolved form, swirling cosmic nebula background that emphasizes the huge scale of it, rainbow prismatic aura, glowing mega stone on its brow' },
    },
  },
};

function stageShape(stageNo, variant) {
  const v = variant ? STAGES.special.variants[variant] : null;
  const [hpLo, hpMax] = v ? [v.hpMin, v.hpMax] : STAGES.hp[stageNo];
  const [dmgLo, dmgMax] = v ? [v.dmgMin, v.dmgMax] : STAGES.dmg[stageNo];
  return `{
  "name": "creature name (use the kid's name idea if they gave one); make it a punny portmanteau of a trait word and an animal/object word; for evolutions keep the root word and escalate the modifier",
  "category": "The X Pokemon",
  "types": ["one or two of: Normal Fire Water Grass Electric Ice Fighting Poison Ground Flying Psychic Bug Rock Ghost Dragon Dark Steel Fairy"],
  "hp": <${hpLo}-${hpMax}, multiple of 10>,
  "flavor": "one silly Pokedex sentence",
  "moves": [{"name": "...", "damage": <${dmgLo}-${dmgMax}, multiple of 10>, "text": "one short fun effect"},
            {"name": "...", "damage": <${dmgLo}-${dmgMax}, multiple of 10>, "text": "one short fun effect"}],
  "artPrompt": "detailed visual prompt for an image model describing exactly what the creature looks like. End with: ${ART_STYLE}",
  "description": "compact visual description of the creature (colors, shapes, features) for reuse in later prompts",
  "backstory": "3-5 sentence funny origin story; ground it like a half-forgotten folk legend when it fits"
}`;
}

async function callJSON(prompt, opts = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await getTextProvider(opts.textProvider).complete({ system: buildSystem(), user: prompt });
    try {
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function extractJSON(apiResponse) {
  const text = (apiResponse.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  return JSON.parse(text);
}

const STAGE_FIELDS = ['name', 'category', 'types', 'hp', 'flavor', 'moves', 'artPrompt', 'description', 'backstory'];

function validateStage(o) {
  for (const f of STAGE_FIELDS) {
    if (o[f] === undefined) throw new Error(`text generation missing field: ${f}`);
  }
  // The model occasionally returns moves as bare strings; the card then renders an empty moves area.
  const badMove = m => !m || typeof m !== 'object' || m.name === undefined || m.damage === undefined || m.text === undefined;
  if (!Array.isArray(o.moves) || o.moves.some(badMove)) {
    throw new Error('text generation missing field: moves shape');
  }
  return o;
}

// The model drifts on numbers despite the prompt bands; clamp deterministically:
// hp/damage into [floor, ceiling] (the variant's own band when set), rounded to
// multiples of 10, and evolutions must beat the prior stage's HP by at least 10.
function clampStage(stage, stageNo, variant, prevHp) {
  const v = variant ? STAGES.special.variants[variant] : null;
  const clamp10 = (x, lo, hi) => Math.min(hi, Math.max(lo, Math.round((+x || 0) / 10) * 10));
  const [hpLo, hpHi] = v ? [v.hpMin, v.hpMax] : STAGES.hp[stageNo];
  const [dmgLo, dmgHi] = v ? [v.dmgMin, v.dmgMax] : STAGES.dmg[stageNo];
  stage.hp = clamp10(stage.hp, hpLo, hpHi);
  if (prevHp) stage.hp = Math.max(stage.hp, prevHp + 10);
  for (const m of stage.moves) m.damage = clamp10(m.damage, dmgLo, dmgHi);
  return stage;
}

// The 5% jackpot: only the evolution INTO stage 3 rolls; result is stored on the stage.
function rollSpecial(stageNo) {
  if (stageNo !== 3) return null;
  const r = Math.random();
  let acc = 0;
  for (const [tier, p] of Object.entries(STAGES.special.odds)) {
    acc += p;
    if (r < acc) return tier;
  }
  return null;
}

// Validation failures (wrong shape, missing fields) get one fresh generation attempt.
async function withValidationRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (!String(e.message).includes('missing field')) throw e;
    return fn();
  }
}

function newPokemon(userPrompt, opts = {}) {
  return withValidationRetry(async () => {
    const data = await callJSON(
      `A kid wants a new Pokemon: "${userPrompt}".
Invent stage 1 of it. Reply with JSON: ${stageShape(1, null)}`, opts);
    validateStage(data);
    return clampStage(data, 1, null);
  });
}

function evolvedStage(record, guidance, variant) {
  const prev = record.stages[record.stages.length - 1];
  const stageNo = record.stages.length + 1;
  const context = {
    name: prev.name, category: prev.category, types: prev.types,
    hp: prev.hp, description: prev.description, backstory: prev.backstory ?? record.backstory,
  };
  return withValidationRetry(async () => {
    const data = await callJSON(
      `This Pokemon: ${JSON.stringify(context)}
Invent its next evolution stage: bigger, more powerful, clearly the same species, sillier if possible.
${guidance ? `The kid wants the evolution to be: ${guidance}\n` : ''}${variant ? `This is a rare ${variant} mega-style evolution - dramatically more powerful and epic.\n` : ''}HP and move damage must be higher than before (hp was ${prev.hp}).
Write a NEW backstory that clearly continues the previous stage's.
Reply with JSON: ${stageShape(stageNo, variant)}`);
    validateStage(data);
    return clampStage(data, stageNo, variant, prev.hp);
  });
}

// Every canon move with power > 150 (from the NotebookLM "Pokemon moves" source,
// pokemondb.net/move/all, cached 2026-07-13). Jeremy's rule: a trainer's finishing
// move comes from this list, and their favorite Pokemon is one that uses it.
const FINISHER_MOVES = [
  'Explosion (Normal, 250)', 'Catastropika (Electric, 210)', 'Pulverizing Pancake (Normal, 210)',
  'Searing Sunraze Smash (Steel, 200)', 'Menacing Moonraze Maelstrom (Ghost, 200)',
  'Light That Burns the Sky (Psychic, 200)', 'Self-Destruct (Normal, 200)',
  'Soul-Stealing 7-Star Strike (Ghost, 195)', 'Oceanic Operetta (Water, 195)',
  '10,000,000 Volt Thunderbolt (Electric, 195)', 'Splintered Stormshards (Rock, 190)',
  "Let's Snuggle Forever (Fairy, 190)", 'Genesis Supernova (Psychic, 185)',
  'Clangorous Soulblaze (Dragon, 185)', 'Malicious Moonsault (Dark, 180)',
  'V-create (Fire, 180)', 'Sinister Arrow Raid (Ghost, 180)', 'Stoked Sparksurfer (Electric, 175)',
  'Eternabeam (Dragon, 160)', 'Gigaton Hammer (Steel, 160)', 'Prismatic Laser (Psychic, 160)',
];

function trainerBackstory({ name, description }) {
  return withValidationRetry(async () => {
    const data = await callJSON(
      `A Pokemon trainer named "${name}", described as: "${description || 'a mysterious trainer'}".
Invent their profile. Their finishing move MUST be picked from this list of devastating canon moves (name, type, power): ${FINISHER_MOVES.join('; ')}.
Their favorite Pokemon MUST be a Pokemon that canonically uses that move (signature Z-moves belong to their signature Pokemon). Pick a pairing that fits this trainer's personality.
Reply with JSON:
{"region": "their home region (canon or invented)", "homeGym": "their home gym: town + gym type, e.g. 'Vermilion City Electric Gym'", "backstory": "3-5 sentence fun trainer origin story that mentions the region and home gym", "favoritePokemon": "the Pokemon", "finishingMove": "the move exactly as listed"}`);
    for (const k of ['region', 'homeGym', 'backstory', 'favoritePokemon', 'finishingMove']) {
      if (data[k] === undefined) throw new Error(`text generation missing field: ${k}`);
    }
    return data;
  });
}

module.exports = { newPokemon, evolvedStage, trainerBackstory, callJSON, extractJSON, validateStage, clampStage, rollSpecial, STAGES, ART_STYLE };
