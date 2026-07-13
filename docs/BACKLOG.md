# Backlog

Queued ideas from Jeremy, deliberately not built yet.
One entry per idea; delete when shipped.

## Display-font button typography cleanup (added 2026-07-13)

Buttons using the PokeDisplay face (Luckiest Guy) render too thick at small sizes and sit high in their boxes.
Causes, verified in style.css: the base `button` rule stacks `font-weight: 800` on a single-weight display font (browser faux-bold smears the glyphs), `.big` adds `-webkit-text-stroke: .6px` on top, and Luckiest Guy's tall-ascent/near-zero-descent metrics push glyphs toward the top of symmetric padding.
Fix: `font-weight: normal` wherever PokeDisplay applies (nav links included), drop the text-stroke below ~1.3rem, and re-center optically with asymmetric padding (a touch more top than bottom) or a small `line-height`/`translateY` nudge; verify with a horizontal-midline overlay screenshot.

## Random special variant at final evolution (added 2026-07-13)

When a Pokemine reaches its final stage (Stage 2), a random roll can crown it something special: EX, DX, Mega, Shiny, etc.
Server-side roll at evolve time (so it can't be rerolled by reloading), stored on the stage record (e.g. `variant: "EX"`).
The EX frame tier CSS already exists and is keyed off stage - a variant would upgrade the treatment further (name suffix on the card, louder foil, maybe an HP/damage bump so it feels earned).
Tuning thought: rare enough to be a shriek-out-loud moment, common enough that each kid hits one within a week or two of play (~1 in 8?).

## Video of a Pokemine using a move (added 2026-07-13)

Generate a short VIDEO clip of the creature performing one of its card moves.
Probably browser-bridge only: consumer Gemini (AI Pro) includes Veo video generation in the web app at no marginal cost, while API video would be expensive.
The bridge extension driver would need a video job type: submit prompt (creature description + move name/effect), wait for the <video> element instead of <single-image>, capture/download the clip, store next to the stage art and show it on the card page (tap the art to play?).

## Pokedex-book view (added 2026-07-12)

A "his own Pokedex" rendering mode styled after the Scholastic handbook spreads in `resources/pokebook/`.
Entry anatomy maps 1:1 onto `pokemon.json`; needs phonetics + height/weight fields at generation time.

## Bridge reference-image support v2 (added 2026-07-12)

The bridge provider is text-prompt only (`supportsReference: false`); continuity rides on the saved description.
v2: paste/attach the previous stage image into the consumer Gemini chat via the extension driver.

## Local Stable Diffusion provider (added 2026-07-12)

`local` provider stub exists; wire it to Draw Things or similar on the Macbook for a free offline option.
