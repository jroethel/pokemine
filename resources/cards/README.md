# Pokemon TCG Card Reference Images

Reference images for the card artifact.
Everything inside the card boundary (the `#card` frame CSS, dex tiles, print sheet) uses these as its design source.
`resources/pokebook/` is a separate family: handbook interior spreads for `#card`-page surroundings and a future Pokedex-book view, not for the card frames themselves.

These are copyrighted Pokemon Trading Card Game card fronts used for design reference only.
**Never commit or ship these files** (covered by `.gitignore` `resources/**/*.png`).

Base Set fronts from the Pokemon TCG API (https://pokemontcg.io/); EX-era fronts added by Jeremy 2026-07-13.

| File                    | Card              | Set      | Why Useful                                    |
|-------------------------|-------------------|----------|-----------------------------------------------|
| Charmander Basic.png    | Charmander        | EX era   | Stage 1 of the evolution line: plain Basic    |
| Charmeleon Stage 1.png  | Charmeleon        | EX era   | Mid evolution: embellishments step up         |
| Charizard stage 2 EX.png| Charizard EX      | EX era   | Final evolution: maximum frame embellishment  |
| Blastose Stage 2 EX.png | Blastoise EX      | EX era   | Second final-stage EX treatment example       |
| fire-charizard.png      | Charizard (Holo)  | Base Set | Iconic fire-type, classic frame with holo     |
| water-blastoise.png     | Blastoise (Holo)  | Base Set | Water-type example                            |
| grass-venusaur.png      | Venusaur (Holo)   | Base Set | Grass-type staple, complex card design        |
| electric-pikachu.png    | Pikachu           | Base Set | Electric-type flagship, clean frame example   |
| electric-zapdos.png     | Zapdos (Holo)     | Base Set | Legendary bird holo treatment                 |
| psychic-alakazam.png    | Alakazam (Holo)   | Base Set | Intricate holographic foil pattern            |
| fighting-machamp.png    | Machamp (Holo)    | Base Set | Multi-limbed pokemon frame                    |
| colorless-clefairy.png  | Clefairy          | Base Set | Colorless-type, simple rounded pokemon        |

## Design rule: embellishment scales with evolution stage

The Charmander -> Charmeleon -> Charizard EX line is the model.
Stage 1 (Basic) is the plainest frame; each evolution steps the frame treatment up (richer borders, holo/foil energy, EX-style flourish at the final stage).
A creature evolves at most twice: three stages total, then it is fully evolved (enforced server-side).
