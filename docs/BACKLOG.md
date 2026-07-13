# Backlog

Queued ideas from Jeremy, deliberately not built yet.
One entry per idea; delete when shipped.

## Auto-crop white padding on generated art (added 2026-07-13)

Gemini returns creature art on a plain white background with generous, inconsistent padding.
After each image comes back, analyze the pixels and crop to a viable minimum padding (uniform left/right and top/bottom margins around the subject).
Hard requirement: no LLM involvement - pure pixel analysis.
Sketch: scan rows/columns from each edge for the first non-near-white pixel (threshold ~[245,245,245] to survive JPEG noise), take the subject bounding box, re-add a fixed margin (say 4-6% of the shorter side) equally on all sides, crop, save.
Zero dependencies is possible for PNG via a small decoder, but the pragmatic route is one tiny image lib (e.g. `sharp`) wired into the provider pipeline right after `generate()` returns, before `saveArt`.
Applies to: pokemon stages, trainer avatars, all providers (bridge images especially, which arrive with wild margins).
Old art stays as is; cropping runs only on new generations.

## Screen `#print` view height uniformity (added 2026-07-13)

On screen the `#print` grid lets card heights vary with content; actual print output is uniform 63x88mm.
Make the screen view mirror the printed uniformity.
(Also recorded in `reference/design-principles.md` under process rules.)

## Pokedex-book view (added 2026-07-12)

A "his own Pokedex" rendering mode styled after the Scholastic handbook spreads in `resources/pokebook/`.
Entry anatomy maps 1:1 onto `pokemon.json`; needs phonetics + height/weight fields at generation time.

## Bridge reference-image support v2 (added 2026-07-12)

The bridge provider is text-prompt only (`supportsReference: false`); continuity rides on the saved description.
v2: paste/attach the previous stage image into the consumer Gemini chat via the extension driver.

## Local Stable Diffusion provider (added 2026-07-12)

`local` provider stub exists; wire it to Draw Things or similar on the Macbook for a free offline option.
