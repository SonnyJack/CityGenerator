# Decisions, open questions and suggested features

## A. Decided

| # | Question | Decision | Consequence |
|---|---|---|---|
| 1 | Licence | Clean-room reimplementation, MIT, copyright "CityGenerator contributors" | `LICENSE` added; CONTRIBUTING.md clean-room policy; no code from the GPL reference |
| 2 | Scale | Metropolitan regions | Hierarchical region → settlement → block model; lazy block generation; MapLibre GL rendering via in-browser vector tiles |
| 3 | Aesthetic | Both ink and modern atlas as themes | Theme compiler to MapLibre style JSON and SVG; ink spike in Phase 1 |
| 4 | Eras | Medieval through modern | Year-based era profiles, growth rings, Call of Cthulhu period packs (1890s, 1920s–30s, modern) |
| 5 | LLM | Bring-your-own-key, Anthropic only to start | Browser-side official SDK; adapter interface kept minimal |
| 6 | Editing | Full editor including brushes | Authored/frozen geometry in the document; draw, edit, brush, freeze, regenerate-in-scope |
| 7 | Export | Call of Cthulhu primarily; no print tiling yet | PNG handouts, SVG, GeoJSON, Universal VTT, Foundry; period and Sanborn themes; player export |
| 8 | Framework | React | — |
| 9 | Estimates | None; be ambitious | Roadmap is dependency-ordered with acceptance criteria and no dates |
| 10 | Document size | Not constrained; JSON import/export is the persistence contract | `.citygen.json` holds spec + authored + overrides + annotations; URL hash only for small documents |
| 11 | Settings and regions | Multiple cultures and biomes around the world | Biome and culture are independent axes with worldwide pack lists (DESIGN §7); cultures can mix per district; era availability is culture-aware |
| 12 | Facility scale | Scale compression on by default | Per-type factor, per-document true-scale toggle, inspector shows both sizes |
| 13 | VTT walls | Universal VTT walls wanted, if performance allows | Walls derived only for the export frame from simplified, merged outlines; segment cap with warning and solid-block fallback |

## B. Open (defaults apply until answered)

**Q14. Ink theme fidelity.** If the Phase 1 spike shows the MapLibre ink theme
is close but not identical to the reference's hand-drawn look, is that
acceptable, or should a dedicated PixiJS renderer be built for it? *Default:
accept if a reviewer judges it "clearly hand-drawn in spirit".*

**Q15. Directory depth.** Should every building get a named business or
household by default, or only on demand per district? *Default: on demand
per district, cached.*

**Q16. Maximum region size.** 60 km on a side is the working target. *Default:
60 km; larger with a coarser base raster.*

**Q17. Public engine API.** Publish `@citygen/core` to npm before v1?
*Default: internal until v1.*

**Q18. Building interiors.** Plan early or keep as a stretch project?
*Default: store `floors`, `use`, `era`, `material` from Phase 3 so interiors
can be added later.*

**Q19. Pack priority.** With worldwide coverage decided, which eight culture
packs and six biomes should ship first? *Default (Phase 7): `newEngland`,
`england`, `france`, `germanyCentralEurope`, `iberia`, `egyptLevant`, `china`,
`japan`; biomes temperate maritime, temperate continental, mediterranean,
boreal, desert, tropical monsoon.*

## C. Suggested features and where they land

| Feature | Phase |
|---|---|
| Year-based eras with mixed-era growth rings | 3 |
| "Why is this here?" inspector | 3 |
| Six-seed variations strip | 1 |
| Full editor with brushes, freeze, reroll brush, handout frames | 4 |
| Tram/streetcar networks and streetcar suburbs | 5 |
| Ports by era, shipyards and dry docks, gasworks, mills, institutions | 6 |
| Biome packs; culture packs, addresses, business and resident directory | 1, 7 |
| Period-1920s and Sanborn themes; player export | 7 |
| LLM assistant with vision snapshots | 8 |
| Growth timeline scrubber; 3D extrusion; decay, flood, fire | 9 |
| Utility networks (power, pipelines, aqueducts, sewers) | 9–10 |
| MCP server and CLI; plugin registry; OSM/DEM import; PWA; gallery | 10 |
| Building interiors | 10 (stretch) |
