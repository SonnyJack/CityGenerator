# CityGenerator

A browser-based procedural generator and editor for metropolitan-scale maps
for tabletop role-playing games, with Call of Cthulhu as the first target.
Inspired by [watabou's Medieval Fantasy City Generator](https://github.com/watabou/TownGeneratorOS)
and extended with:

- metropolitan regions: a core city, satellite towns, villages and countryside
  in one document, navigable from region overview to individual buildings;
- eras from medieval to modern chosen by year, with mixed-era growth rings and
  period content for the 1890s and 1920s–30s;
- modern infrastructure: railways, tram lines, train yards, ports by era,
  shipyards and dry docks, industrial zones and institutions;
- wealth and density fields that shape layout and are visible as overlays;
- a general feature-placement engine with manual pinning and gap filling;
- topography with rivers, coasts, bathymetry, contours and terrain-aware roads
  and rail;
- a full editor: draw, edit, brush, freeze and regenerate around your changes;
- an LLM assistant (Anthropic, bring-your-own-key) that answers questions about
  the map and edits it;
- worldwide biome and culture packs, mixable per district;
- a static site on GitHub Pages built with TypeScript, Vite, React and
  MapLibre GL.

## Status

Phases 0 to 3 are complete: the monorepo, CI and GitHub Pages deployment,
the document format and deterministic engine, terrain with hydrology, land
cover, contours, hillshade and 3-D terrain, and settlements: sited on the
terrain, laid out as organic towns with walls, gates, plazas, wards and
streets, with buildings generated lazily per block as you zoom in, and roads
routed between them. A year slider moves the region through ten era
profiles: towns keep their organic core and grow rings of Georgian grids,
streetcar blocks, post-war suburbs and cul-de-sacs, zoned from wealth and
density fields that you can overlay and inspect. Both an atlas and an ink
theme render everything.

Phase 4 adds the editor: draw streets, railways, canals, walls, buildings,
zones and points; select, move, rotate, scale, mirror and edit vertices with
snapping; brush the terrain, wealth, density and zones; freeze generated
buildings or remove them; regenerate a settlement or the whole layout while
your features stay put; annotate with labels, markers, GM notes and handout
frames; browse the history and reopen recent documents.

Phase 5 adds railways and trams: mainlines and branch lines routed on the
terrain within a ruling gradient, with cuttings, embankments, viaducts and
tunnels; stations, goods and marshalling yards with steam-era roundhouses,
freight spurs to docks and industry, subways under big cities after 1900,
branch-line closures after the 1960s, street-running tram lines with stops
and depots, and level crossings where rail meets road.

Phase 6 adds the placement engine and a library of ports, harbours,
shipyards, industry, institutions and airports, each with era variants:
finger piers become break-bulk quays and then container terminals, gasworks
come and go, hospitals change from pavilions to blocks. Facilities are placed
by constraints and scores, connected by rail spurs and access roads, reserve
their land in the towns, and can be pinned or removed. Naming, points of
interest and export are next (Phase 7).

## Development

```sh
pnpm install
pnpm dev          # editor at http://localhost:5173
pnpm check        # lint, typecheck, unit tests, build
pnpm e2e          # Playwright end-to-end tests
```

Deployment: pushes to `main` build the site and publish it with the
`pages.yml` workflow. The repository's Pages source must be set to
"GitHub Actions" once (Settings → Pages).

## Documents

Start here:

- [docs/DESIGN.md](docs/DESIGN.md) — architecture, data model, pipeline,
  placement engine, rendering, editor, LLM integration.
- [docs/ROADMAP.md](docs/ROADMAP.md) — phases, deliverables, acceptance criteria.
- [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) — decisions taken, questions
  still open, and where suggested features land.
