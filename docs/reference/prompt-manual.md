# Pokemine Prompt Manual

Every prompt sent to a text model or an image model, how it is assembled, and which knob changes what.
As of 2026-07-25. Companion to [architecture.md](architecture.md).

The goal here is that when you want to tweak *something the model says or draws*, you can find the exact string,
know what feeds into it, and know what else re-uses it before you change it.

## How to read this

Prompts are assembled from **fixed blocks** (constants you can edit once) and **runtime pieces** (kid input, prior
stage data, a rolled variant). Every section below lists the source location, the final assembled shape, and the
variants that can appear inside it.

There are exactly **two families**:

- **Text prompts** -> a JSON blob (name, stats, moves, art prompt, etc.). All live in `lib/text.js`.
- **Image prompts** -> one image. Assembled in `server.js`, using art fragments from `lib/text.js` and continuity
  helpers from `lib/providers.js`.

---

## Part A - Text prompts (`lib/text.js`)

Every text call is `{ system, user }` -> raw string that must parse as JSON (`callJSON`).
The **system** prompt is shared by all four text calls; the **user** prompt is what differs per flow.

### A0. The shared system prompt (every text call)

Source: `SYSTEM` + `buildSystem()`.

```
You invent silly Pokemon-style creatures for a kid aged 12-14.
Humor: silly and gross-out humor is great. Keep everything PG and kind, but add a degree of cinematic realism.
Always answer with pure JSON only, no markdown fences.
```

Variant: if env `CANON_FILE` points at a file, its contents are appended as:

```
## Universe canon
<file contents>
```

Tweak points:

- Age band, humor level, tone ("cinematic realism") - edit `SYSTEM` directly.
- House lore that should color *every* generation - put it in the `CANON_FILE`, don't inline it.

### A1. The stage schema (`stageShape`) - shared by Create and Evolve

Both Create and Evolve end their user prompt with `Reply with JSON: <stageShape(...)>`.
`stageShape(stageNo, variant)` returns the JSON template the model fills in. The **only** things that change between
calls are the two number ranges (HP band, damage band), which come from the stage number or the variant's own band.

Template fields (each has an inline instruction to the model):

| Field         | Instruction summary                                                                       |
|---------------|-------------------------------------------------------------------------------------------|
| `name`        | Use the kid's name idea if given; punny portmanteau of a trait + animal/object word.      |
|               | For evolutions, keep the root word and escalate the modifier.                             |
| `category`    | "The X Pokemon".                                                                          |
| `types`       | 1-2 of the 18 canon types (listed inline).                                                |
| `hp`          | In the band `<hpLo>-<hpMax>`, multiple of 10. Band depends on stage/variant (below).       |
| `flavor`      | One silly Pokedex sentence.                                                               |
| `moves`       | Exactly 2, each `{name, damage, text}`; damage in the band, multiple of 10.               |
| `artPrompt`   | Detailed visual prompt for the image model. **Must end with the shared `ART_STYLE`.**     |
| `description` | Compact visual description (colors, shapes, features) for reuse in later prompts.         |
| `backstory`   | 3-5 sentence funny origin; ground it like a half-forgotten folk legend when it fits.      |

The HP and damage bands are the whole numeric variant system:

| Context             | HP band    | Damage band | Source                      |
|---------------------|------------|-------------|-----------------------------|
| Stage 1 (Basic)     | 30 - 120   | 10 - 60     | `STAGES.hp[1]`, `.dmg[1]`   |
| Stage 2             | 60 - 160   | 30 - 120    | `STAGES.hp[2]`, `.dmg[2]`   |
| Stage 3 (normal)    | 90 - 200   | 60 - 200    | `STAGES.hp[3]`, `.dmg[3]`   |
| Stage 3 **VMAX**    | 220 - 260  | 220 - 260   | `STAGES.special.variants`   |
| Stage 3 **EX**      | 240 - 300  | 240 - 300   | `STAGES.special.variants`   |
| Stage 3 **Mega**    | 260 - 340  | 260 - 340   | `STAGES.special.variants`   |

Important: the prompt only *asks* for numbers in these bands. `clampStage()` then **forces** them in code (rounds to
tens, clamps to the band, makes each evolution beat the prior HP by >=10). So editing a band changes both the ask
and the guarantee - edit the band in `STAGES`, not the prose.

### A2. Create - the "new Pokemon" user prompt (`newPokemon`)

Called by `POST /api/pokemon`. Always stage 1, never a variant.

```
A kid wants a new Pokemon: "<kid's prompt>".
Invent stage 1 of it. Reply with JSON: <stageShape(1, null)>
```

The only runtime piece is the kid's raw prompt string. No prior context (it's the first stage).

### A3. Evolve - the "next stage" user prompt (`evolvedStage`)

Called by `POST /api/pokemon/:id/evolve`. This is the richest text prompt and has the most variants.

Assembled shape (pieces in brackets are conditional):

```
This Pokemon: <JSON of prev stage: name, category, types, hp, description, backstory>
Invent its next evolution stage: bigger, more powerful, clearly the same species, sillier if possible.
[The kid wants the evolution to be: <guidance>.]                         <- only if the kid typed guidance
[This is a rare <VARIANT> mega-style evolution - dramatically more       <- only on a rolled special (stage 3)
 powerful and epic.
 Have this picture include an appropriate scenic background.]
HP and move damage must be higher than before (hp was <prevHp>).
Write a NEW backstory that clearly continues the previous stage's.
Reply with JSON: <stageShape(stageNo, variant)>
```

Runtime pieces / variants:

- **Previous-stage context** - always injected as JSON, so the model stays on-species.
- **Guidance** - the optional text the kid typed into the box before pressing EVOLVE. Absent -> that line is dropped.
- **Variant** - `rollSpecial(3)` result. Absent (normal evolution, or evolving into stage 2) -> the whole variant
  block is dropped and `stageShape` uses the normal band.
- **`prevHp`** - forces the "higher than before" instruction to be concrete.

Note: the variant **word** in the text prompt is the object key (`VMAX` / `EX` / `Mega`), which is why the text
prompt says "rare Mega mega-style evolution" for Mega. If that phrasing bugs you, that's the seam.

### A4. Trainer profile - `trainerBackstory`

Called on trainer create and on first profile view (backfill). Not a creature; a trainer dossier.

```
A Pokemon trainer named "<name>", described as: "<description or 'a mysterious trainer'>".
Invent their profile. Their finishing move MUST be picked from this list of devastating canon moves
(name, type, power): <FINISHER_MOVES joined with '; '>.
Their favorite Pokemon MUST be a Pokemon that canonically uses that move (signature Z-moves belong to their
signature Pokemon). Pick a pairing that fits this trainer's personality.
Reply with JSON:
{"region": "...", "homeGym": "town + gym type", "backstory": "3-5 sentences mentioning region and gym",
 "favoritePokemon": "...", "finishingMove": "the move exactly as listed"}
```

Variant / knob: `FINISHER_MOVES` is a hard-coded list of every canon move with power > 150 (from the NotebookLM
"Pokemon moves" source, cached 2026-07-13). The trainer's finisher is constrained to this list, and their favorite
Pokemon must be one that uses it. Edit the list to change the pool of finishers.

---

## Part B - Image prompts

Image prompts are assembled in `server.js` (one per flow), pulling shared art fragments from `lib/text.js` and the
continuity helper from `lib/providers.js`. Three fixed fragments recur:

### B0. The shared art fragments

**`ART_STYLE`** (`lib/text.js`) - the house look, appended to *every* `artPrompt` by the text model:

```
Cel-shaded official Pokemon-style game art in the Ken Sugimori watercolor style: simple readable silhouette,
bold slightly-varied outlines, 1-2 midtone main colors plus one accent, soft purple-tinted shadows, basic
highlights, full body, single creature, plain white background. Do not write the creature's name or any text,
letters, numbers, logos, or watermarks anywhere in the image. Do your best to honor specifics and intent of the
kid's prompt.
```

**`NO_TEXT`** (`server.js`) - a shorter no-text reminder re-appended on Evolve and Alter:

```
Do not write the creature's name or any text, letters, numbers, logos, or watermarks anywhere in the image.
```

**Variant art phrases** (`STAGES.special.variants[tier].art`) - appended when a stage is/was a special:

| Tier | Art phrase                                                                                          |
|------|-----------------------------------------------------------------------------------------------------|
| VMAX | crackling electric-blue energy, radiant silver aura, sparks flying                                  |
| EX   | wreathed in golden fire, glowing prismatic divine radiance                                          |
| Mega | colossal mega-evolved form, swirling cosmic nebula background emphasizing scale, rainbow prismatic  |
|      | aura, glowing mega stone on its brow                                                                |

**`withContinuity(provider, prompt, description)`** (`lib/providers.js`) - if the provider has no reference-image
support and a description exists, appends `\nThe creature looks like this: <description>`. Otherwise returns the
prompt unchanged (reference-capable providers get the actual prior image instead).

**Bridge-only suffix** - the `bridge` provider appends `\nSquare image, 1:1 aspect ratio.` when it writes the job
(`writeBridgeJob` in `lib/providers.js`). Gemini/z.ai set 1:1 via the API config instead.

### B1. Create image prompt (`POST /api/pokemon`)

```
<withContinuity(provider, artPrompt, '')>
The kid asked for: <kid's prompt>.
```

- `artPrompt` is the field the text model just produced (already ends with `ART_STYLE`).
- The description arg is empty here (nothing prior to stay continuous with), so `withContinuity` is effectively a
  no-op on create - it only matters on evolve/alter.
- The kid's original words are re-stated to the artist as a final intent nudge.

### B2. Evolve image prompt (`POST /api/pokemon/:id/evolve`)

```
<withContinuity(provider,
  "Evolve this creature. Its evolved form: <artPrompt>
   Same species, same color palette, same art style, clearly a bigger more powerful evolution.
   The evolved form should look sturdier or sharper than before, same palette, keep one signature feature.",
  <prev stage description>)>
[The kid asked for: <guidance>.]            <- only if guidance was typed
[<variant art phrase>.]                      <- only on a rolled special
<NO_TEXT>
```

Plus, separately from the prompt text: if the provider `supportsReference`, the **previous stage's image file** is
attached as a reference (`reference = { data, mime }`). That is the strongest continuity lever and only Gemini/mock
use it; `zai` and `bridge` fall back to the description injected by `withContinuity`.

Variants that stack here: guidance (kid text), variant art phrase (rolled special), and reference-vs-description
(provider capability). All three can be present at once on a Gemini stage-3 special evolution with kid guidance.

### B3. Alter / Redraw image prompt (`POST /api/pokemon/:id/alter`)

The most conditional prompt. Base clause depends on whether the kid typed anything:

**With instruction:**
```
<instruction>. Keep it the same creature, same cel-shaded Pokemon-style game art, full body, plain white background.
```

**Blank (redraw my original):**
```
Draw this creature fresh: <stage 0 uses the kid's original words; later stages use the stage description>
```

Then, conditionally:

- If there's no reference image **and** a description exists **and** we didn't already embed it in the base clause,
  append `\nThe creature looks like this: <description>`.
- If the stage is/was a special, append `\n<variant art phrase>.` (so a redraw keeps its foil look).
- Always append `\n<NO_TEXT>`.

Reference image: used when the provider supports it **and** the current art isn't the mock placeholder
(a <500-byte file is treated as "no real art to draw from").

Side effect worth knowing: an instructed alter appends `Recently altered: <instruction>.` to the stage
`description`, so subsequent no-reference prompts inherit the change. (Marked `ponytail:` in code as a naive
continuity note - a vision re-caption would be the upgrade if drift ever matters.)

### B4. Trainer avatar prompt (`POST /api/trainers`)

Fixed, no variants beyond the kid's description:

```
Pokemon trainer portrait: <description>. Friendly bust portrait, cel-shaded Ken Sugimori watercolor style,
plain white background. Do not write any text, letters, numbers, logos, or watermarks in the image.
```

---

## Part C - Quick reference: what to edit for a given tweak

| I want to change...                          | Edit this                                                        |
|----------------------------------------------|-----------------------------------------------------------------|
| Overall tone / age / humor of all text       | `SYSTEM` in `lib/text.js`                                        |
| House lore in every generation               | Set `CANON_FILE` env (contents appended to system)              |
| The house art style                          | `ART_STYLE` in `lib/text.js`                                     |
| HP / damage numbers per stage                | `STAGES.hp` / `STAGES.dmg` in `lib/text.js` (+ `clampStage`)     |
| Special-variant rarity                       | `STAGES.special.odds` in `lib/text.js` (see odds note below)    |
| A special variant's stats or foil art        | `STAGES.special.variants[tier]` in `lib/text.js`                |
| Add a new lane (GX, Gigantamax)              | `odds` + `variants` in `lib/text.js`; `VARIANT_LABELS` + a       |
|                                              | `.variant-<tier>` block in `public/app.js` / `style.css`        |
| What the evolve prompt tells the artist      | The template string in `evolvedStage` / evolve route in server  |
| The finishing-move pool for trainers         | `FINISHER_MOVES` in `lib/text.js`                                |
| The no-text / watermark rule                 | `ART_STYLE` (create) and `NO_TEXT` (evolve/alter)               |
| Whether continuity uses image vs description | Provider's `supportsReference` flag in `lib/providers.js`       |

**Odds note:** `STAGES.special.odds` currently sums to **0.30** (VMAX 0.12 + EX 0.10 + Mega 0.08), so ~30% of final
evolutions become special - even though the code comments still say 5% / 20%. Decide the real target rarity before
adding lanes, since every new lane you add here changes the total. Specials only roll when evolving **into stage 3**.
