# Pokemine "Grand Reveal" Design Brief

For the impeccable-driven restyle of the frontend. Assembled 2026-07-12 from the handbook cover, the official color standards Jeremy supplied, and the generated wordmark.

## Assets

- **Logo**: `resources/logo/logo-candidate-1.jpg` (chosen; candidate-2 is the alternate). White background, 16:9, yellow/navy Pokemon-style wordmark. Copy into `public/` for use; it sits best on white or very light surfaces. Do not stretch; scale proportionally.

## Color tokens

| Token            | Hex       | Source and use                                                    |
|------------------|-----------|-------------------------------------------------------------------|
| brand-yellow     | `#FFCB05` | Logo yellow (designpieces). Primary CTA fill, brand accents.       |
| brand-gold       | `#C7A008` | Logo gold shadow. CTA 3D shadow (already used by `.big`).          |
| brand-blue       | `#2A75BB` | Logo blue. Nav, primary chrome (already in use).                   |
| brand-navy       | `#3C5AA6` | Logo navy outline. Headings, text on yellow (already in use).      |
| poke-red         | `#FF0000` | Franchise red (schemecolor "Digital Red"). Cover-field accent.     |
| poke-red-deep    | `#CC0000` | Franchise dark red ("Russian Red"). Lattice alternate/depth.       |
| poke-blue-alt    | `#3B4CCA` | Franchise blue ("Light Ultramarine"). Sparing secondary accent.    |
| poke-yellow-alt  | `#FFDE00` | Franchise yellow ("Golden Yellow"). Highlights, sparingly.         |
| poke-gold-muted  | `#B3A125` | Franchise muted gold ("Xanthophyll"). Borders/shadows on yellow.   |

Existing per-type colors in `style.css` stay as-is (they match TCG conventions).

## Cover aesthetic (from `resources/pokebook/handbook-geppetto_0.jpg`)

- Crimson red field made of 45-degree diamond lattice with thin white grid lines; some diamonds are pastel tiles. Reproduce as a pure-CSS pattern (repeating-linear-gradient pair at +/-45deg), red field for hero/header zones only, never behind body text.
- Chunky, all-caps display typography, yellow fill with navy outline and slight bevel; white "sticker" outlines around badges. CSS approximation: heavy weights, `text-shadow`/`-webkit-text-stroke`, rounded corners.
- Overall register: joyful, dense, collectible, kid-first. Big touch targets stay big.

## Direction per view

- **Create (the reveal moment)**: logo front and center on a light surface, diamond-lattice red band as the stage behind or above it, giant yellow GENERATE button. This screen is the first thing his son sees; it should feel like opening the handbook cover.
- **Card view**: the card remains the hero; chrome recedes. Do not redesign the card frame internals (print-verified at 63x88mm).
- **Pokedex**: grid tiles may take the pastel-diamond tile flavor from the cover.
- **Print view**: functional; print CSS output must remain pixel-identical in card dimensions.

## Hard constraints

- No build step, no new dependencies, no frameworks. Only `public/index.html`, `public/app.js`, `public/style.css` (plus copying the logo asset into `public/`).
- `npm test` stays green; print card size stays exactly 63mm x 88mm; all existing functionality (provider dropdown, inline editing, alter/evolve, cost counter) untouched.
- Kid-usable on a Chromebook screen (~1366x768) and narrower.
- Use the `mock` provider for any interactive checks: zero API spend for styling work.
