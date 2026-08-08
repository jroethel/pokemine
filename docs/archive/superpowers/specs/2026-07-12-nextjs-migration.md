# Pokemine - Next.js Migration Path (deferred)

Date: 2026-07-12
Status: reference for a future session. Do not build until the plain app feels limiting.

## Trigger conditions

Migrate only if one of these actually happens:

- The single frontend JS file grows past ~800 lines and view logic is tangling.
- You want multiplayer or accounts (cousins with their own Pokedexes).
- You want to deploy it off the Macbook (Vercel or similar).

## What carries over unchanged

- Image provider layer (`gemini`, `zai`, `bridge`, `local`) - pure Node modules, drop into `lib/`.
- Storage format and Drive-synced `DATA_DIR` - untouched; Next API routes read the same folders.
- All prompt engineering (art style, evolution continuity, kid-safe text prompts).
- Card CSS - becomes a `<PokemonCard>` component with the same styles.
- Print stylesheet.

## What gets rewritten

- Express routes become Next.js route handlers (`app/api/*/route.ts`), thin wrappers over the same lib code.
- The four views become React components with client state; Pokedex grid gets `next/image` thumbnails.
- `.env` moves to Next's env convention (server-only vars stay server-only by default).

## Estimated shape

Roughly a one-session migration if the plain app kept the provider and storage layers as separate modules, which the Plan A spec requires.
