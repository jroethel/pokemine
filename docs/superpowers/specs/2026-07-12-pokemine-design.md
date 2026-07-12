# Pokemine - Design Spec (Plan A: API)

Date: 2026-07-12
Status: approved direction, pending final user review

## Purpose

A silly-Pokemon generator for Jeremy's son (age 8-12, types his own prompts).
Runs on the Macbook; he uses it from his Chromebook over the home LAN.
He types a prompt ("a butt Pokemon named Gyatt"), gets AI artwork on a real-looking game card, and can alter it, evolve it, read its backstory, browse his growing Pokedex, and print physical cards.

## Architecture

One Node.js server (Express, the single runtime dependency) bound to `0.0.0.0:3000`.
It serves a no-build plain HTML/CSS/JS frontend and a small JSON API.
No database, no bundler, no auth (home LAN only).
Server prints its LAN URL on startup.
macOS will prompt once to allow incoming connections.

## Storage

Plain files under a data directory, which is a Google Drive-synced folder (free backup, viewable anywhere).
Path is set via `DATA_DIR` in `.env`; defaults to `./data` if unset.

```
<DATA_DIR>/pokemon/<id>/
  pokemon.json      # name, types, stats, moves, backstory, flavor text, per-stage data, prompts used
  stage-1.png       # artwork per evolution stage
  stage-2.png
  stage-1.v1.png    # previous art kept on alteration (one level of undo)
```

One evolution line = one folder.
Each stage has its own name, stats, and art inside `pokemon.json`.
Deleting a Pokemon = deleting a folder.

## Image provider layer

One interface: `generate({ prompt, referencePng? }) -> PNG buffer`, plus a `supportsReference` capability flag.
Provider is selectable from a dropdown in the frontend; default comes from `.env` (`DEFAULT_IMAGE_PROVIDER`).

| Provider | Status | Model                    | Reference-image edits          |
|----------|--------|--------------------------|--------------------------------|
| `gemini` | real   | `gemini-3.1-flash-image` | Yes (native image input)       |
| `zai`    | real   | `glm-image`              | No, text-description fallback  |
| `bridge` | stub   | consumer Gemini via jobs | See Plan B spec                |
| `local`  | stub   | future: Draw Things / SD | n/a                            |

When a provider lacks reference support, the server injects a detailed text description of the existing creature into the prompt to preserve visual continuity.
Stubs throw a clear "not implemented" error that surfaces as a friendly UI message.

Verified 2026-07-12 with live calls:

- Gemini key (project 319193243056, see `nano-api.md`): text works free; image models return quota `limit: 0` until billing is linked. ~$0.034/image at 1K once enabled.
- Z.AI key (from zai-mcp-server config): `glm-image` and `cogview-4-250304` respond but need a pay-as-you-go balance; the GLM Coding Plan does not cover image generation.

## Text generation

Always Gemini `gemini-flash-latest` (free tier, verified working).
One structured-JSON call returns name suggestions, Pokedex flavor text, backstory, types, stats, and two moves per stage.
System prompt: kid-appropriate, silly and gross-out humor welcome, PG.
Text provider is not selectable in the UI (YAGNI: it is free and works).

## Frontend (one page, four views)

- **Create**: big prompt box, provider dropdown tucked in a corner, big GENERATE button, fun loading animation (10-25s generations).
- **Card**: HTML/CSS card frame with the AI art inside (crisp editable text, consistent look, print-sharp). Buttons: Alter (redraw via reference edit), Evolve, Backstory panel. Name, HP, and moves are inline-editable.
- **Pokedex**: numbered gallery grid of all saved cards; click to open.
- **Print**: `@media print` stylesheet rendering selected cards at real TCG size (63x88mm) on Letter sheets for cutting out.

## Evolution and alteration

Both are image-edit calls: previous stage PNG plus an instruction ("evolve this creature into a larger, more powerful form, same species, palette, and art style").
Alteration replaces current stage art; the prior version is kept as `stage-N.v1.png`.
Stats regenerate for a new stage, scaled up.

## Errors and cost

API failures show a kid-friendly retry message ("The Pokemon escaped! Try again!"); the server logs the real error.
UI footer shows images generated this session and approximate cost.

## Config

`.env`: `GEMINI_API_KEY`, `ZAI_API_KEY`, `PORT`, `DEFAULT_IMAGE_PROVIDER`, `DATA_DIR`.
Keys are never sent to the frontend.

## Testing

One `node --test` file: card JSON validation, provider selection and fallback logic (fetch mocked), file-store round-trip.
Manual E2E (generate, alter, evolve, print preview) via browser once Gemini billing is enabled.

## Open items (user actions)

1. Link a billing account to Google Cloud project 319193243056 to unlock image generation.
2. Optional: add a small balance at z.ai to make the `zai` provider live.
3. Choose the Drive-synced folder to use as `DATA_DIR`.

## Related specs

- Plan B (browser bridge provider): `2026-07-12-plan-b-browser-bridge.md`
- Next.js migration path: `2026-07-12-nextjs-migration.md`
