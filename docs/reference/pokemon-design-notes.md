# Pokemon Design Notes (cached from NotebookLM "Create: New Pokemon")

Cached 2026-07-12 from notebook `cc40970a-799e-415f-9e97-2df75471ba9c` (17 sources as of the evening refresh).
Raw source text lives in `docs/reference/notebook-cache/` (refresh with `python3 scripts/refresh-notebook-cache.py`).
Universe lore is distilled separately into `canon-pack.md`, which is the file the app injects into generation prompts.
Known-bad sources: the two Bulbapedia entries ("History of the Pokemon world", "Pokemon universe") are Cloudflare-block stubs with no real content; delete or replace them in the notebook.
Purpose: raw material for tuning the generation prompts in `lib/text.js` (SYSTEM, ART_STYLE, STAGE_SHAPE) and the evolve/alter prompts in `server.js`.
This is a prompt-content cache, not an architecture input.

## Art style (for ART_STYLE and artPrompt guidance)

From the Sugimori style and r/fakemon sources:

- Clear shape language, simplicity, contrast are the cornerstones.
- Silhouette must be readable and built from a few simple shapes; no detail is an afterthought.
- 1-2 main colors per design, optionally one accent that pops; typing guides the palette.
- Colors are midtone: no pure black (use dark grey), no hot pink (use midtone reddish-pink), moderate saturation.
- Basic shadows and highlights only, never dramatic; shadows tinted purple/indigo, not black.
- Line weight mostly uniform with slight variation (thicker outer contour).
- Pre-evolutions are simpler and cuter than later stages.
- Overall intent: the creature should feel like "a friend, an animal a person could trust", with a mix of friendly and monster-like.

Candidate ART_STYLE upgrade (draft, tune during E2E):
"Cel-shaded official Pokemon-style game art in the Ken Sugimori watercolor style: simple readable silhouette, bold slightly-varied outlines, 1-2 midtone main colors plus one accent, soft purple-tinted shadows, basic highlights, full body, single creature, plain white background."

## Shape language (for evolution progression and personality)

- Circles/rounds: friendly, soft, harmless, approachable. Use for cute stage-1 creatures.
- Squares/rectangles: solid, sturdy, strong, reliable, grounded. Use for mid evolutions.
- Triangles/points: sharp, dynamic, dangerous, menacing. Use for final evolutions or "edge".
- Mixing shapes is encouraged (Pichu: circle head/body + triangular ears for edge).
- Shapes can deliberately mislead (round villain, spiky hero); useful for silly subversions.

Evolution prompt idea: stage 1 leans circles, stage 2 adds squares/bulk, stage 3 adds triangles/points, while keeping species, palette, and one signature feature constant.

## Sugimori's "keep the balance" rule (for silly designs, fits this app perfectly)

- If a design is too cool, add something uncool; too serious, add something cheerful.
- Deliberately imperfect touches make a design memorable (Oshawott's freckles).
- Too cool = forgettable. This validates the app's silly/gross-out humor as design-correct.

## Naming patterns (for the name field in STAGE_SHAPE)

From the pokemondb etymology table (sampled ~40 entries; full 1000+ entry table stays in the notebook, pull on demand):

- Names are almost always a portmanteau of 2 (occasionally 3) descriptive words: trait + animal/object.
  Examples: Growlithe (growl + lithe), Arcanine (arcane + canine), Oddish (odd + radish), Geodude (geo + dude).
- Evolution lines keep one root and escalate the modifier: Machop / Machoke / Machamp; Poliwag / Poliwhirl / Poliwrath; Nidoran / Nidorina / Nidoqueen.
- Suffix tricks: -lett/-ita for small ("Diglett"), royalty/power words for final stages (Nidoking, Machamp).
- Sound-symbolism and onomatopoeia are fair game (Meowth, Zubat from Japanese "zubatto").
- Prompt implication: ask the model for a punny portmanteau, and for evolutions keep the root and upgrade the modifier.

## Type chart (standard Gen 6+ chart, confirmed by the pokemondb source)

18 canonical types: Normal, Fire, Water, Electric, Grass, Ice, Fighting, Poison, Ground, Flying, Psychic, Bug, Rock, Ghost, Dragon, Dark, Steel, Fairy.
The app's STAGE_SHAPE currently offers 12; the missing six are Ice, Poison, Ground, Flying, Bug, Rock.
Super-effective quick list (attacker -> 2x targets):

| Attacker  | Super effective vs             | Attacker | Super effective vs               |
|-----------|--------------------------------|----------|----------------------------------|
| Fire      | Grass, Ice, Bug, Steel         | Psychic  | Fighting, Poison                 |
| Water     | Fire, Ground, Rock             | Bug      | Grass, Psychic, Dark             |
| Electric  | Water, Flying                  | Rock     | Fire, Ice, Flying, Bug           |
| Grass     | Water, Ground, Rock            | Ghost    | Psychic, Ghost                   |
| Ice       | Grass, Ground, Flying, Dragon  | Dragon   | Dragon                           |
| Fighting  | Normal, Ice, Rock, Dark, Steel | Dark     | Psychic, Ghost                   |
| Poison    | Grass, Fairy                   | Steel    | Ice, Rock, Fairy                 |
| Ground    | Fire, Electric, Poison, Rock, Steel | Fairy | Fighting, Dragon, Dark          |
| Flying    | Grass, Fighting, Bug           | Normal   | (none)                           |

Immunities worth knowing for card flavor: Normal/Fighting cannot hit Ghost; Ground cannot hit Flying; Electric cannot hit Ground; Psychic cannot hit Dark; Dragon cannot hit Fairy.
Use for move flavor text and "weakness" lines if cards ever grow them; not load-bearing today.

## Backstory inspiration: yokai origins

Many classic Pokemon are yokai from Japanese folklore: Vulpix/Ninetales = kitsune (tails = age and power), Lotad = kappa (water bowl on head = strength), Drowzee = baku (dream eater), Shiftry = tengu (fan-wind), Whiscash = namazu (earthquake catfish), Magikarp = koi legend (weak fish becomes dragon).
Prompt implication for backstories: ground silly creatures in a folk-legend shape ("legend says...", a weakness rule, a transformation myth).
The Magikarp pattern (pathetic stage 1, absurdly powerful final stage) is a great gag for evolutions.

## Source inventory (pull on demand via notebooklm-mcp)

Notebook: `cc40970a-799e-415f-9e97-2df75471ba9c` ("Create: New Pokemon").

| Source                                   | ID                                     | Cached here?          |
|------------------------------------------|----------------------------------------|-----------------------|
| Shape Language                            | `285e911e-aa8a-43d8-a877-577d88fc90a5` | Yes (distilled)       |
| Sugimori style - Pokemon Workshop         | `06203b55-135c-46b3-b11e-5ff234c5384c` | Yes (tutorial links)  |
| Sugimori design interview - NintendoSoup  | `8745519c-0779-4708-87f9-7784d9d19579` | Yes (balance rule)    |
| Pokemon art style - r/fakemon             | `ba193bc4-d2ec-4097-a98d-fed65a9304b8` | Yes (distilled)       |
| Name origins (etymology) - pokemondb      | `3fff2ac6-a8db-49cd-afe0-09d78b5722ac` | Patterns only (127k char table in notebook) |
| Type chart - pokemondb                    | `833fa2be-78d4-4f70-9722-f83fa81d3b6b` | Yes (compact chart)   |
| Pokemon based on yokai - Japan Avenue     | `ecbffe78-ecc9-45be-91ba-1c6c55d364a4` | Yes (distilled)       |
| PokeAPI documentation                     | `64accc81-f6b2-4345-a2f5-e656ff03129d` | No (app does not use PokeAPI; live docs at pokeapi.co) |
| Pokemon evolution charts                  | `1dc8c822-7ddc-4af9-b8ec-381a0874c8c8` | No (big table, pull on demand) |
| Evolution curriculum (Philadelphia)       | `606edce1-5f4f-484b-bfea-fa0a45ff47b9` | No (educational essay, low prompt value) |
| List of Pokemon - Wikipedia               | `5dc8126b-d9eb-40e4-a2a0-e7499e99baec` | No (huge index, pull on demand) |

## How to apply later (one small pass, after the build lands)

1. Replace `ART_STYLE` in `lib/text.js` with the Sugimori draft above.
2. Add naming guidance to `STAGE_SHAPE`'s name field: punny portmanteau; evolutions keep the root word and escalate the modifier.
3. Add the six missing types to the types list in `STAGE_SHAPE` (and matching CSS type colors in `public/style.css`).
4. Add shape-language progression and the Magikarp gag option to the evolve prompt in `server.js`.
5. Add folk-legend framing to the backstory instruction.
6. Canon injection: in `lib/text.js`, if the file named by `CANON_FILE` in `.env` exists (default `docs/reference/canon-pack.md`), append its contents to the SYSTEM prompt at startup. ~5 lines; makes canon refreshable without code edits (notebook -> refresh script -> re-distill canon-pack.md -> restart server).
7. Regenerate one test Pokemon per change batch; judge by eye (taste gate).
