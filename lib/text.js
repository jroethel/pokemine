const fs = require('fs');

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

const ART_STYLE = 'Cel-shaded official Pokemon-style game art in the Ken Sugimori watercolor style: simple readable silhouette, bold slightly-varied outlines, 1-2 midtone main colors plus one accent, soft purple-tinted shadows, basic highlights, full body, single creature, plain white background.';

const STAGE_SHAPE = `{
  "name": "creature name (use the kid's name idea if they gave one); make it a punny portmanteau of a trait word and an animal/object word; for evolutions keep the root word and escalate the modifier",
  "category": "The X Pokemon",
  "types": ["one or two of: Normal Fire Water Grass Electric Ice Fighting Poison Ground Flying Psychic Bug Rock Ghost Dragon Dark Steel Fairy"],
  "hp": <30-120, multiple of 10>,
  "flavor": "one silly Pokedex sentence",
  "moves": [{"name": "...", "damage": <10-90, multiple of 10>, "text": "one short fun effect"},
            {"name": "...", "damage": <10-90, multiple of 10>, "text": "one short fun effect"}],
  "artPrompt": "detailed visual prompt for an image model describing exactly what the creature looks like. End with: ${ART_STYLE}",
  "description": "compact visual description of the creature (colors, shapes, features) for reuse in later prompts"
}`;

async function callJSON(prompt) {
  // gemini-flash-latest returns malformed JSON ~1 in 4 calls; retry the parse once.
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildSystem() }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    const body = await res.json();
    if (body.error) throw new Error(`gemini text: ${body.error.message}`);
    try {
      return extractJSON(body);
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

const STAGE_FIELDS = ['name', 'category', 'types', 'hp', 'flavor', 'moves', 'artPrompt', 'description'];

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

// Validation failures (wrong shape, missing fields) get one fresh generation attempt.
async function withValidationRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (!String(e.message).includes('missing field')) throw e;
    return fn();
  }
}

function newPokemon(userPrompt) {
  return withValidationRetry(async () => {
    const data = await callJSON(
      `A kid wants a new Pokemon: "${userPrompt}".
Invent stage 1 of it. Reply with JSON:
{"stage": ${STAGE_SHAPE}, "backstory": "3-5 sentence funny origin story; ground it like a half-forgotten folk legend when it fits"}`);
    validateStage(data.stage);
    if (data.backstory === undefined) throw new Error('text generation missing field: backstory');
    return data;
  });
}

function evolvedStage(record) {
  const prev = record.stages[record.stages.length - 1];
  const context = {
    name: prev.name, category: prev.category, types: prev.types,
    hp: prev.hp, description: prev.description, backstory: record.backstory,
  };
  return withValidationRetry(async () => {
    const data = await callJSON(
      `This Pokemon: ${JSON.stringify(context)}
Invent its next evolution stage: bigger, more powerful, clearly the same species, sillier if possible.
HP and move damage must be higher than before (hp was ${prev.hp}).
Reply with JSON: ${STAGE_SHAPE}`);
    return validateStage(data);
  });
}

module.exports = { newPokemon, evolvedStage, callJSON, extractJSON, validateStage, ART_STYLE };
