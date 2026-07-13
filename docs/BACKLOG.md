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

## Display-font button typography cleanup (added 2026-07-13)

Buttons using the PokeDisplay face (Luckiest Guy) render too thick at small sizes and sit high in their boxes.
Causes, verified in style.css: the base `button` rule stacks `font-weight: 800` on a single-weight display font (browser faux-bold smears the glyphs), `.big` adds `-webkit-text-stroke: .6px` on top, and Luckiest Guy's tall-ascent/near-zero-descent metrics push glyphs toward the top of symmetric padding.
Fix: `font-weight: normal` wherever PokeDisplay applies (nav links included), drop the text-stroke below ~1.3rem, and re-center optically with asymmetric padding (a touch more top than bottom) or a small `line-height`/`translateY` nudge; verify with a horizontal-midline overlay screenshot.

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
