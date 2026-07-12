# Pokebook resources: motif and Pokedex reference

Canonical home for Pokemon visual reference assets (images gitignored; this README is tracked).
Captured 2026-07-12 from the poke-book tab group (Geppetto's Toys product gallery + Amazon gallery for the same book, ISBN 9781339028019), merged with Jeremy's own grabs of the same gallery (higher-resolution copies kept: ~2367x1772 vs 1500x1125).
Purpose: visual reference for a future "Pokedex page" / "his own Pokedex book" rendering mode and general motif design.
Convention for future expansion: one subfolder per asset family (e.g. `cards/` for TCG card fronts, `sprites/`, `books/<isbn>/`).

## Files

| File                    | Content                                                            |
|-------------------------|--------------------------------------------------------------------|
| handbook-geppetto_0.jpg | Cover                                                              |
| handbook-geppetto_1.jpg | "How To Use This Book" spread: full entry anatomy, annotated       |
| handbook-geppetto_2.jpg | "Guide to Pokemon Types" spread: 18 type ribbons with mascots      |
| handbook-amazon_1..8    | Cover variants plus interior entry spreads (86-87, 402-403, 556-557 sampled and verified) |

## Pokedex entry anatomy (from the spreads)

- Angled parallelogram name banner, top corner of each entry: NAME in heavy caps, category subtitle beneath ("Radiator Pokemon"), color keyed to the creature's type.
- Italic "#0851"-style number in a yellow chevron next to the banner (4-digit, zero-padded).
- "TYPE: FIRE-BUG" header in bold caps, then two short description paragraphs separated by a hatched divider.
- Stat block, bold labels: HOW TO SAY IT (phonetic), IMPERIAL HEIGHT/WEIGHT, METRIC HEIGHT/WEIGHT, GENDER (male/female symbols or Unknown), ABILITIES, WEAKNESSES.
- Evolution strip: small sprites with yellow arrows and names in yellow tabs; "DOES NOT EVOLVE" as a standalone yellow badge; special "LEGENDARY POKEMON" green/yellow banner variant.
- Background: light halftone dot pattern; each entry sits on a soft type-tinted panel; page numbers in rounded corner badges.
- Creature art: large, full-body, white-outlined against the tinted panel.

## App implications (later pass, not scheduled)

- A "Pokedex page" view could render each creature like these spreads: the record already has every field except phonetic pronunciation and height/weight (cheap to add to STAGE_SHAPE).
- The entry anatomy maps 1:1 onto `pokemon.json` fields; the halftone + angled-banner look is pure CSS.

## Queued task (lesser agent, later)

Gather reference images of actual Pokemon TCG cards (front frames across types, including Trainer/Energy variants) into `cards/` here, for tuning the HTML/CSS card frame. Sources: TCG product galleries or pokemontcg.io image API. Owner: a future Sonnet/GLM session; no judgment required beyond "is it a clear card front".
