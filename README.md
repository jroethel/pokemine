<p align="center">
  <img src="public/banner.png" alt="Pokemine - silly Pokemon, dreamed up by kids" width="100%">
</p>

# Pokemine

Silly Pokemon generator. Runs on the Macbook; play from any browser on the LAN.

## Run

    npm install
    npm start

The console prints two URLs - use the Chromebook one from his device.

## Setup (once)

Copy `.env.example` to `.env` and fill in:

- `GEMINI_API_KEY` - AI Studio key on a billing-enabled project (images ~ $0.034 each; text is free)
- `ZAI_API_KEY` - optional, needs a pay-as-you-go balance at z.ai
- `DATA_DIR` - point at a Google Drive-synced folder to back up the Pokedex
- `CANON_FILE` - path to the canon pack appended to every text prompt; must exist or text generation fails (default `docs/reference/canon-pack.md`)
- `TEXT_PROVIDER` - which text model to use (`gemini` default; `anthropic`/`openai` route to GLM via z.ai)

See `.env.example` for the full list of variables.

## Providers

Pick the artist in the dropdown: `gemini` (best), `zai` (needs balance),
`mock` (free blank image, for testing), `bridge`/`local` (not built yet - see
`docs/superpowers/specs/` to build them out).

## Test

    npm test
