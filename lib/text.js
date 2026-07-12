const URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

const SYSTEM = `You invent silly Pokemon-style creatures for a kid aged 8-12.
Humor: silly and gross-out humor is great. Keep everything PG and kind.
Always answer with pure JSON only, no markdown fences.`;

const ART_STYLE = 'Cel-shaded official Pokemon-style game art, bold outlines, full body, single creature, plain white background.';

const STAGE_SHAPE = `{
  "name": "creature name (use the kid's name idea if they gave one)",
  "category": "The X Pokemon",
  "types": ["one or two of: Normal Fire Water Grass Electric Psychic Fighting Fairy Ghost Dragon Dark Steel"],
  "hp": <30-120, multiple of 10>,
  "flavor": "one silly Pokedex sentence",
  "moves": [{"name": "...", "damage": <10-90, multiple of 10>, "text": "one short fun effect"},
            {"name": "...", "damage": <10-90, multiple of 10>, "text": "one short fun effect"}],
  "artPrompt": "detailed visual prompt for an image model describing exactly what the creature looks like. End with: ${ART_STYLE}",
  "description": "compact visual description of the creature (colors, shapes, features) for reuse in later prompts"
}`;

async function callJSON(prompt) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`gemini text: ${body.error.message}`);
  return extractJSON(body);
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
  return o;
}

async function newPokemon(userPrompt) {
  const data = await callJSON(
    `A kid wants a new Pokemon: "${userPrompt}".
Invent stage 1 of it. Reply with JSON:
{"stage": ${STAGE_SHAPE}, "backstory": "3-5 sentence funny origin story"}`);
  validateStage(data.stage);
  if (data.backstory === undefined) throw new Error('text generation missing field: backstory');
  return data;
}

async function evolvedStage(record) {
  const prev = record.stages[record.stages.length - 1];
  const context = {
    name: prev.name, category: prev.category, types: prev.types,
    hp: prev.hp, description: prev.description, backstory: record.backstory,
  };
  const data = await callJSON(
    `This Pokemon: ${JSON.stringify(context)}
Invent its next evolution stage: bigger, more powerful, clearly the same species, sillier if possible.
HP and move damage must be higher than before (hp was ${prev.hp}).
Reply with JSON: ${STAGE_SHAPE}`);
  return validateStage(data);
}

module.exports = { newPokemon, evolvedStage, extractJSON, validateStage, ART_STYLE };
