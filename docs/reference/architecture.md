# Pokemine Architecture

How the thing actually works under the hood, as of 2026-07-25.
Written so you can find the seam you want to tweak without re-reading every file.

Companion doc: [prompt-manual.md](prompt-manual.md) covers every prompt string and its variants in detail.

## 1. What Pokemine is (and isn't) today

Pokemine is a **generator and collection**, not a battle game.

- It turns a kid's text idea into a Pokemon-style card: art, name, types, HP, two moves, flavor, backstory.
- Cards **evolve** (up to 3 stages) and can be **redrawn/altered**.
- There are **trainers** (a profile with an avatar, region, home gym, favorite Pokemon, finishing move).
- Cards carry battle-shaped numbers (HP, move damage, types) but **nothing consumes them**.
  There is no turn loop, no type-effectiveness resolution, no "play" between two cards.

That gap matters for your lanes/mechanics plan: the numbers exist, the *game that reads them* does not yet.
See Section 8.

## 2. The stack

Plain Node, no framework, no build step, no database.

| Layer      | What                                    | Where                          |
|------------|-----------------------------------------|--------------------------------|
| Server     | Express, one file, SSE for streaming    | `server.js`                    |
| Text gen   | LLM providers (Gemini / GLM via z.ai)   | `lib/text.js`, `lib/text-providers.js` |
| Image gen  | Image providers (Gemini / z.ai / bridge)| `lib/providers.js`             |
| Post       | White-margin autocrop (pixel-only)      | `lib/autocrop.js`              |
| Storage    | Folder-per-Pokemon on disk (JSON + art) | `lib/store.js`                 |
| Frontend   | One vanilla JS file, hash routing       | `public/app.js`, `public/style.css` |
| Bridge     | Brave extension driving consumer Gemini | `bridge-extension/`, `/api/bridge/*` |

State lives entirely on disk under `DATA_DIR` (default `./data`, in practice a Google Drive folder for backup).
Restart the server and nothing is lost except the in-memory session cost counter.

## 3. Data model

One Pokemon is one folder: `<DATA_DIR>/pokemon/<slug>-<base36-timestamp>/`.
Inside: `pokemon.json` plus `stage-1.png`, `stage-2.png`, etc. (and `.v1` backups when a stage is redrawn).

`pokemon.json` shape:

```jsonc
{
  "id": "sparkmouse-lqx7z2",        // slug of stage-0 name + creation timestamp; the folder name
  "number": 4,                       // per-record Pokedex number (creation order)
  "createdAt": "2026-07-25T...",
  "createdBy": "ash-abc",           // optional trainer slug
  "stages": [
    {
      "name": "Sparkmouse",
      "category": "The Zappy Pokemon",
      "types": ["Electric"],
      "hp": 60,
      "flavor": "one silly Pokedex sentence",
      "moves": [ { "name": "...", "damage": 30, "text": "..." }, { ... } ],
      "description": "compact visual description, reused in later prompts",
      "backstory": "3-5 sentences",
      "prompt": "the kid's original words for this stage",
      "number": 7,                   // per-STAGE global collector number (see below)
      "art": "stage-1.png",
      "variant": "EX"                // present only on a rolled special stage (Section 6)
    }
  ]
}
```

Two different "numbers" coexist, on purpose:

- **`record.number`** - one per Pokemon, creation order. This is the "#004" you think of as its Pokedex number.
- **`stage.number`** - one **global** sequence across every live stage of every Pokemon (`store.nextNumber()`).
  So each evolution stage gets its own collector number, like separate cards in a real set.

Trainers are a parallel tree: `<DATA_DIR>/trainers/<slug>/trainer.json` + `avatar.<ext>`.

**Deletes are soft.** Archiving moves the folder to a sibling `archive/` (or `trainers-archive/`), never `rm`.
Anything "deleted" can be rescued by moving the folder back.

## 4. The three generation flows

Every flow is: build a prompt -> call text and/or image provider -> autocrop -> write to disk -> return.
The two create/evolve routes **stream** progress over Server-Sent Events (`phase` -> `phase` -> `done`/`error`).
Alter is a plain JSON POST (fast enough not to need streaming).

### 4a. Create (`POST /api/pokemon`) - `server.js`

1. Guard: empty prompt -> 400; `bridge` provider with no driver connected -> 400 `bridge-offline` (fail fast, no 5-min hang).
2. SSE `phase: text` -> `text.newPokemon(prompt)` returns a validated, stat-clamped **stage 1**.
3. SSE `phase: image` -> image provider draws `artPrompt` (+ continuity + the kid's words). Autocrop.
4. If the image call throws: store a 1x1 placeholder, mark `outcome: art-failed`, still save the card.
   The card renders with a nudge to Redraw; the text is never lost to an art failure.
5. `store.create()` writes the folder and `pokemon.json`, then `saveArt` writes `stage-1.png`.
6. SSE `done` with the full record.

### 4b. Evolve (`POST /api/pokemon/:id/evolve`) - `server.js`

1. Guard: already 3 stages -> 400 "fully evolved". Real TCG rule: Basic -> Stage 1 -> Stage 2, stop.
2. **Roll the special variant** (`text.rollSpecial(stageNo)`) - only fires when evolving *into* stage 3. Section 6.
3. SSE `phase: text` -> `text.evolvedStage(record, guidance, variant)` builds the next stage from the previous one's
   context (name, types, hp, description, backstory) plus any kid guidance and the variant flavor.
4. SSE `phase: image` -> draw the evolved art. If the provider `supportsReference`, the **previous stage's image is
   passed as a reference image** for visual continuity; otherwise the saved text `description` carries continuity.
5. Append the new stage (with its own `stage.number`, and `variant` if rolled), save, SSE `done`.

### 4c. Alter / Redraw (`POST /api/pokemon/:id/alter`) - `server.js`

Redraws the art of one existing stage in place (backing up the old art as `.v1`). Does **not** touch text/stats.

- **With an instruction** ("give it a hat"): "keep the same creature" + the instruction. Appends a note to `description`.
- **Blank instruction** = "draw my original idea again": stage 0 reuses the kid's own words, later stages reuse `description`.
- Reference image is used when the provider supports it and real art exists (not the mock placeholder).
- A special stage re-appends its variant art phrase so it keeps its look on redraw.

### 4d. Trainer create (`POST /api/trainers`) - `server.js`

Avatar art and backstory lore run **in parallel** (`Promise.all`); lore failure never blocks trainer creation.
Backstory is backfilled + persisted on first profile view for older trainers (see the GET route).

## 5. Providers (swap points)

Two independent provider registries, both selectable per-request and remembered in `localStorage`.

**Text** (`lib/text-providers.js`): `gemini` (Gemini Flash, free), `anthropic` (GLM-4.7 via z.ai's Anthropic-shaped
endpoint - the current default per `.env`), `openai` (GLM via z.ai's OpenAI-shaped endpoint).
All three take the same `{ system, user }` and return a raw string that must parse as JSON.

**Image** (`lib/providers.js`): each is `{ real, supportsReference, generate({prompt, reference}) -> {data, mime} }`.

| Provider | Real | Ref image | Notes                                                              |
|----------|------|-----------|-------------------------------------------------------------------|
| `gemini` | yes  | yes       | `gemini-3.1-flash-image`, 1:1. Best quality. ~$0.034/image.       |
| `zai`    | yes  | no        | GLM-image, 1024x1024. Needs a paid balance.                       |
| `bridge` | yes  | no        | Routes through consumer Gemini web app via the Brave extension.   |
| `mock`   | yes  | yes       | Returns the 1x1 pixel. Free. For dev/tests.                       |
| `local`  | stub | -         | Reserved for Draw Things / SD on the Mac. Not built.              |

`supportsReference` is the important flag: it decides whether continuity rides on a **reference image** or on the
**text description** (`withContinuity()` in `lib/providers.js` injects the description only for no-reference providers).

## 6. The special-variant system (VMAX / EX / Mega) - the mechanic you're extending

This is the whole current "lane" system, and it lives in one object: `STAGES.special` in `lib/text.js`.

```js
special: {
  odds: { VMAX: 0.12, EX: 0.1, Mega: 0.08 },   // rolled ONLY when evolving into stage 3
  variants: {
    VMAX: { hpMin: 220, hpMax: 260, dmgMin: 220, dmgMax: 260, label: 'VMAX', art: '...energy...' },
    EX:   { hpMin: 240, hpMax: 300, dmgMin: 240, dmgMax: 300, label: 'EX',   art: '...golden fire...' },
    Mega: { hpMin: 260, hpMax: 340, dmgMin: 260, dmgMax: 340, label: 'MEGA', art: '...cosmic...' },
  },
}
```

What a variant actually changes, end to end:

1. **Roll** - `rollSpecial(3)` walks the odds in order and returns a tier or `null`. Only stage 3 rolls.
2. **Stats** - `stageShape()` and `clampStage()` swap the normal per-stage bands for the variant's own `hp*/dmg*`
   floors, so a special always out-stats a normal stage 3.
3. **Text prompt** - `evolvedStage()` adds "This is a rare {variant} mega-style evolution..." and asks for a scenic bg.
4. **Image prompt** - the variant's `art` phrase is appended to the evolve prompt (and re-appended on redraw).
5. **Card render** - `public/app.js` adds a `variant-<tier>` CSS class and a name suffix/prefix
   (`VARIANT_LABELS`, and Mega renders as a prefix "MEGA Name"). The Pokedex list shows a variant chip.

> **Odds discrepancy worth deciding on.** The code comments in `lib/text.js` say the specials "sum to 5%" (line 23)
> and "sums to 20%" (line 28), but the actual `odds` sum to **0.30**. So today ~30% of final evolutions become
> special, not the "~1 in 8" the backlog imagined. Pick the real number before you add GX/Gigantamax lanes, because
> every lane you add here dilutes or inflates that total. This is the single knob that controls specialness rarity.

**To add a lane (GX, Gigantamax, etc.) the mechanical work is:** one entry in `odds`, one in `variants` (bands + art
phrase + label), one entry in `VARIANT_LABELS` in `app.js`, and one `.variant-<tier>` block in `style.css`.
That is the full blast radius of a cosmetic+stat lane today. A lane that changes *play* needs Section 8 first.

## 7. Cross-cutting concerns

- **Stat integrity** is enforced in code, not trusted to the model. `clampStage()` rounds HP/damage to multiples of
  10, clamps into the band, and forces each evolution to beat the prior stage's HP by >=10. The prompt *asks* for
  good numbers; the clamp *guarantees* them.
- **Validation + retry.** `validateStage()` checks all required fields (including move shape). A missing-field error
  triggers exactly one fresh generation (`withValidationRetry`). JSON-parse failures get up to 3 attempts (`callJSON`).
- **Cost tracking.** `logCost(provider)` bumps an in-memory session counter and a persistent `costs.json` ledger.
  The ledger is protected: if it is momentarily unreadable (a Drive sync stall), the write is skipped rather than
  clobbering the real totals with zeros.
- **Autocrop** trims the white padding every image arrives with and re-adds a uniform 5% margin, caps the long side
  at 1024, and **never throws** - any failure returns the original art. Pure pixels, no LLM, no cost.
- **Canon injection.** If `CANON_FILE` is set, its contents are appended to the text system prompt as "Universe canon"
  (read lazily per call). This is how house lore would reach every generation.
- **Error translation.** Server errors are forwarded raw; the client (`public/friendly-errors.js`) maps them to
  kid-safe lines ("high demand" -> "The lab is busy"). Mid-SSE errors are sent as an `error` event, not a dead 500.

## 8. Where a real game mechanic would attach (for the lanes/battle plan)

There is no play loop today, so "cards that influence the mechanics of the game" implies building the mechanics layer.
The pieces already on the card that a battle engine could read:

- `types` (1-2) - a type-effectiveness chart is cached in `docs/reference/notebook-cache/` but unused in code.
- `hp`, `moves[].damage`, `moves[].text` - numbers exist and are integrity-clamped.
- `variant` - the natural hook for lane-specific rules (e.g. a VMAX taking two prize cards, a Mega skipping a turn).

None of this is wired to anything. A mechanics layer would be a **new module** (say `lib/battle.js`) plus new routes
and UI; it would *read* the existing record, and lane rules would branch on `stage.variant`.
Nothing in the current data model blocks it - the numbers and the variant tag are already persisted per stage.

Recommended next step before building lanes: a brainstorm on the play loop (what a "mechanic" resolves, who plays
whom, what a lane changes about resolution), then a plan. This spec is the map; the lanes are new territory on it.
