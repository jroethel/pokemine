# Pokemine Design Principles

Distilled 2026-07-12 from the impeccable skill's general rules plus this project's own case law.
Every agent touching `public/` reads this BEFORE changing UI, and screenshots its work against it.
Register: kid-facing product UI (design serves the product) with comic-book brand energy.
The user test: a kid on a 1366x768 Chromebook understands it in two seconds and can hit it with a trackpad.

## Interaction (where this project has actually been burned)

- **Never hijack navigation to gate an optional feature.** Browsing must always work. Nudge in place; do not redirect. (Case law: the trainer picker hijacked every route; viewing the Pokedex required an avatar. Wrong.)
- **Interactive controls live in the flow; corners are for status.** Top-right is display territory (cost badge). Anything a kid must click goes in the menu row or the content. (Case law: "Choose trainer" button in the top-right corner.)
- **Size harmony**: a control's height matches its text-line neighbors; a button should never be 2x the height of the label beside it. (Case law: the New Trainer GO button.)
- Big touch targets everywhere; primary action is visually the biggest thing in its group.
- Decorative layers (watermarks, bursts, overlays) get `pointer-events: none`. A decoration must never eat a click.
- Every clickable looks clickable; every editable can be revealed (the Highlight editable toggle).

## Color and surfaces

- Body text contrast >= 4.5:1 against its actual background; large/bold text >= 3:1. No washed-out gray on tinted surfaces - darken within the surface's own hue instead.
- Chrome (nav, panels) should have material presence: gradients within one hue, a highlight edge, a shadow edge - relief, not flatness. (Case law: the flat blue nav read as dull.)
- One accent used deliberately (brand yellow on blue); type colors stay as the TCG-convention set.

## Typography and layout

- Display font (Luckiest Guy) for nav and headings only; body stays the system stack. Pair on contrast, never two similar fonts.
- Body line length <= 75ch. `text-wrap: balance` on headings.
- Vary spacing for rhythm; nested cards are always wrong; flexbox for 1D, grid for 2D.
- Semantic z-index scale (content < sticky nav < overlay < lightbox < loading). No 9999.
- Nothing overflows its container at 1366x768 or narrower; the viewport is part of the design.
- No artificial page-width cap on `main`. (Case law: a `max-width: 960px` on `main` squeezed the 2x card view - card, idea box, and buttons fought for width. `main` now fills the space beside the rail; individual content blocks self-limit instead.)
- The card view is a `card-row` flex: the 2x card (660px on screen) beside a side panel bounded to 560px so backstory prose keeps the 75ch rule; it wraps to stacked below ~910px of available width.
- The card art WINDOW is 8:5 landscape (`.card-art { aspect-ratio: 8/5 }`), measured off real cards (Base Set Charizard ~1.60:1, modern Charmander ~1.64:1) with `object-fit: contain` on a white ground: generated art is 1:1 on plain white and auto-cropped subject-tight server-side (`lib/autocrop.js`), so letterboxing is invisible and no creature is ever cropped. Legacy art of any ratio also displays fine.

## Motion

- Ease-out curves only (quart/expo); no bounce. Every animation has a `prefers-reduced-motion` fallback.
- Never gate content visibility on an animation firing.

## Absolute bans (from impeccable, kept where relevant here)

- Gradient text (background-clip). Glassmorphism as default. Colored side-stripe borders as accents.
- Identical card grids where variety is possible (the dex's rotating pastel tiles exist for this reason).
- Text overflowing containers at any supported width.

## Brand assets

- `public/logo.jpg` - plain wide wordmark (1376x768); used as the create-view in-page hero (`.create-logo`) only.
- `public/logo-burst.png` - wordmark in a comic starburst, transparent background, square (1024x1024).
  This is the nav brand on EVERY view; there is no per-view swap.
  (Case law: a stale JS swap set the brand to `logo.jpg` on `#create`, so the sidebar showed the plain wordmark there. Removed - the nav brand is always the burst.)

## Nav: the left sidebar rail

The nav is a fixed-width LEFT sidebar rail (~210px), not a top bar.
Rationale: a top bar plus a page-width cap were stealing the vertical space the 2x card view needs; a left rail frees the full height.

- Order, top to bottom: burst logo (fills the rail, ~150-170px tall), the `+ New` primary link, the trainer chip directly under it, then Pokedex / Print / Help, and the cost badge pinned to the bottom.
- The burst logo is intentionally large (it fills the rail width); a cramped small logo in a wide rail reads as a mistake.
- `+ New` is the primary action: comic red, the biggest control in the group (primary action is biggest in its group).
- The trainer chip and every nav link are interactive, so they live in the click flow of the rail; only the cost badge is status, pinned to the bottom out of the flow.
- Nav links are Luckiest Guy, ~1.3rem, block-level with generous padding - big trackpad targets for kids.
- The rail is `position: sticky; height: 100vh` so it stays put while `main` scrolls; it is `display:none` in print and never affects print metrics.

## Process rules for agents

- Screenshot every changed view at 1366x768 and self-critique against this doc before reporting.
- Verification servers: scratch DATA_DIR + off-port only; never bind 3000; never kill processes you did not start.
- Print output is sacred: cards are 63x88mm exactly, chrome never leaks into print. Under print media the art window flex-shrinks so text never bleeds past the card box - verify 0px spill on EVERY card, not just the first card's box size.
- Case law (css-sizing-4, found 2026-07-13): a box with `aspect-ratio` gets a CONTENT-BASED MINIMUM size while its overflow is visible, so a child image's intrinsic ratio can silently override the declared aspect. `overflow: hidden` on the box (plus flex + min-size 0 on the child) is load-bearing on `.card-art`. This was the cause of the screen `#print` height variance.
- The card box itself is `aspect-ratio: 63/88` at every screen size - true card proportions everywhere, not just in print.
