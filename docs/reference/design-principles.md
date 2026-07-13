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

## Motion

- Ease-out curves only (quart/expo); no bounce. Every animation has a `prefers-reduced-motion` fallback.
- Never gate content visibility on an animation firing.

## Absolute bans (from impeccable, kept where relevant here)

- Gradient text (background-clip). Glassmorphism as default. Colored side-stripe borders as accents.
- Identical card grids where variety is possible (the dex's rotating pastel tiles exist for this reason).
- Text overflowing containers at any supported width.

## Brand assets

- `public/logo.jpg` - plain wordmark (landing hero).
- `public/logo-burst.jpg` - wordmark in comic starburst (nav brand on non-landing views). Source: `resources/logo/logo-burst-2.jpg`; alternate candidate `-1` is softer.
- Nav proportions: menu bar height ~70% of the rendered burst-logo height; the burst overlaps the bar so the bar appears to shoot out of it (see `resources/logo/Screenshot 2026-07-12 at 10.16.06 PM.png`).

## Process rules for agents

- Screenshot every changed view at 1366x768 and self-critique against this doc before reporting.
- Verification servers: scratch DATA_DIR + off-port only; never bind 3000; never kill processes you did not start.
- Print output is sacred: cards are 63x88mm exactly, chrome never leaks into print.
