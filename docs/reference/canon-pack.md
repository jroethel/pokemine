# Pokemon Universe Canon Pack

Purpose: compact canon context injected into the text-generation system prompt (`lib/text.js`).
Keep this file under ~80 lines; it rides along on every generation call.
Refresh workflow: add sources to the NotebookLM notebook, run `python3 scripts/refresh-notebook-cache.py`, then re-distill this file and `pokemon-design-notes.md`.
Distilled 2026-07-12 from the notebook cache (CBR creation myth, TheGamer war theory, ScreenRant universe history, pokemondb, Wikipedia).

## World rules

- Pokemon are not animals; they are creatures that coexist with humans as partners, wild neighbors, and legends. Rare ordinary animals exist but are almost never seen.
- Ten-year-olds may travel the world as Pokemon trainers, catching Pokemon in Pokeballs and challenging Gym Leaders.
- Each Pokemon knows a small set of named moves; battles are sport, never fatal, and end when a Pokemon faints.
- Regions (Kanto, Johto, Hoenn, Sinnoh, Unova, Kalos, Alola, Galar, Paldea) are separate lands, each with its own Pokedex, professor, and legends.
- A Pokedex is a field encyclopedia; every species has a number, a category ("The X Pokemon"), a height, a weight, and a short entry.

## Creation myth (Sinnoh's "Original Story")

- The universe began as swirling chaos; from it hatched an egg containing Arceus, "The Original One".
- Arceus shaped Dialga (time), Palkia (space), and Giratina (antimatter, banished to the Distortion World), plus the Lake Spirits Uxie, Mesprit, and Azelf (knowledge, emotion, willpower).
- A hiker's secret in Platinum: all Pokemon may be tiny fragments of Arceus' original form.
- Myth-making pattern: old stories get garbled over centuries; a creature can be "purposely wiped from history or simply forgotten".

## Deep history timeline (for legends and backstories)

1. Creation: Arceus, the Creation Trio, the Lake Spirits.
2. Elemental titans form: Groudon (magma), Kyogre (deep sea), Rayquaza (ozone); Regigigas drags the continents apart, creating the regions.
3. Dawn of humans; prehistoric Pokemon (Aerodactyl, Kabutops) roam, then mostly go extinct by the last Ice Age.
4. Ancient wars: the Kalos War 3000 years ago (a grieving giant's resurrection machine turned ultimate weapon ended it); a rumored Great War in Kanto's recent past explains the missing adults and why kids run everything.
5. Primal battles: Groudon vs Kyogre fight over primal energy until Rayquaza descends to stop them, twice.
6. Modern era: Pokemon Leagues, Gyms, Team Rocket-style crime syndicates filling power vacuums, professors handing starters to kids.

## Pokedex entry voice (for flavor text)

- Third-person field-guide register, present tense, two short sentences max.
- One mundane observation plus one absurd, alarming, or oddly specific fact.
- Never says "cool" or editorializes; the horror or comedy is deadpan.
- Style reference (pattern, from training knowledge, not the cache): "It clears entire rooms in seconds. Scientists refuse to study it twice."

## Naming and evolution conventions (summary; details in pokemon-design-notes.md)

- Names are punny portmanteaus: trait + animal/object (Oddish = odd + radish).
- Evolution lines keep the root and escalate the modifier (Machop, Machoke, Machamp).
- Evolutions grow bigger and sharper: round and cute, then sturdy, then dramatic, same palette and one signature feature throughout.
- The Magikarp gag is canon-approved: a pathetic creature may evolve into something absurdly mighty.
- Categories are always "The X Pokemon" (The Butt Pokemon, The Flame Pokemon).

## Tone guardrails for this app

- Silly, gross-out, and deadpan-absurd humor are encouraged; everything stays PG and kind.
- Legends and wars are mythic and bloodless; danger is cartoonish, never graphic.
- Invented creatures live in this universe: give them a region-sounding home, a Pokedex-style entry, and legends that sound half-forgotten.
