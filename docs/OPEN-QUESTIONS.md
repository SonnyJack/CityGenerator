# Decisions, open questions and suggested features

## A. Decided (v0.2)

| # | Question | Decision | Consequence |
|---|---|---|---|
| 1 | Licence | Clean-room reimplementation, permissive licence (MIT proposed) | CONTRIBUTING.md clean-room policy; no code from the GPL reference |
| 2 | Scale | Metropolitan regions | Hierarchical region → settlement → block model; lazy block generation; MapLibre GL rendering via in-browser vector tiles |
| 3 | Aesthetic | Both ink and modern atlas as themes | Theme compiler to MapLibre style JSON and SVG; ink spike in Phase 1 |
| 4 | Eras | Medieval through modern | Year-based era profiles, growth rings, Call of Cthulhu period packs (1890s, 1920s–30s, modern) |
| 5 | LLM | Bring-your-own-key, Anthropic only to start | Browser-side official SDK; adapter interface kept minimal |
| 6 | Editing | Full editor including brushes | Authored/frozen geometry in the document; draw, edit, brush, freeze, regenerate-in-scope |
| 7 | Export | Call of Cthulhu primarily; no print tiling yet | PNG handouts, SVG, GeoJSON, Universal VTT, Foundry; period and Sanborn themes; player export |
| 8 | Framework | React | — |
| 9 | Estimates | None; be ambitious | Roadmap is dependency-ordered with acceptance criteria and no dates |
| — | Document size | Not constrained; JSON import/export is the persistence contract | `.citygen.json` holds spec + authored + overrides + annotations; URL hash only for small documents |

## B. Still open (answer when convenient; defaults shown)

**Q10. Copyright holder string for the MIT licence.** *Default: the GitHub
account name.*

**Q11. Call of Cthulhu settings to prioritise.** 1920s New England (Lovecraft
Country) and 1890s/1920s England are assumed first; is Modern-day needed early,
and are non-Anglophone settings (Berlin, Cairo, Shanghai) wanted in the first
culture packs? *Default: `newEngland` and `england` first.*

**Q12. Realism vs. playability for large facilities.** Ports and yards shrink
by a per-type scale-compression factor by default so a port does not consume a
town; a "true scale" toggle exists. Acceptable? *Default: compression on.*

**Q13. Maximum region size to design for.** 60 km on a side is the working
target; larger regions are possible with a coarser base raster. *Default:
60 km.*

**Q14. Ink theme fidelity.** If the Phase 1 spike shows the MapLibre ink theme
is close but not identical to the reference's hand-drawn look, is that
acceptable, or should a dedicated PixiJS renderer be built for it? *Default:
accept if a reviewer judges it "clearly hand-drawn in spirit".*

**Q15. Directory depth.** Should every building get a named business or
household by default (larger documents and generation cost), or only on
demand per district? *Default: on demand per district, cached.*

**Q16. VTT specifics.** Foundry VTT scene export is assumed; are Roll20 or
Owlbear Rodeo needed, and is Universal VTT wall data (line-of-sight from
building outlines) valuable for your play? *Default: Foundry + Universal VTT.*

**Q17. Public engine API.** Should `@citygen/core` be published to npm as a
supported library, or remain internal until v1? *Default: internal until v1.*

**Q18. Building interiors.** Floor-plan generation for selected buildings is
listed as a stretch project; is it important enough to plan for early (it
affects what buildings store)? *Default: store `floors`, `use`, `era`,
`material` from Phase 3 so interiors can be added without regeneration.*

## C. Suggested features and where they land

| Feature | Phase |
|---|---|
| Year-based eras with mixed-era growth rings | 3 |
| "Why is this here?" inspector | 3 |
| Six-seed variations strip | 1 |
| Full editor with brushes, freeze, reroll brush, handout frames | 4 |
| Tram/streetcar networks and streetcar suburbs | 5 |
| Ports by era, shipyards and dry docks, gasworks, mills, institutions | 6 |
| Culture packs, addresses, business and resident directory | 7 |
| Period-1920s and Sanborn themes; player export | 7 |
| LLM assistant with vision snapshots | 8 |
| Growth timeline scrubber; 3D extrusion; decay, flood, fire | 9 |
| Utility networks (power, pipelines, aqueducts, sewers) | 9–10 |
| MCP server and CLI; plugin registry; OSM/DEM import; PWA; gallery | 10 |
| Building interiors | 10 (stretch) |
