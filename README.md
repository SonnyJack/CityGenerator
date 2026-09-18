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
their land in the towns, and can be pinned or removed.

Phase 7 names everything and gets it out of the browser: eight culture
packs (New England, England, France, Central Europe, Iberia, Egypt and the
Levant, China, Japan) give each region its settlement, river, street,
district and business names, its building kinds and materials, and its
pre-modern street pattern; every building has a use, an occupant and an
address, searchable in a directory; labels render in all themes, including
the new 1920s survey, Sanborn, blueprint, dark and print themes; and any
frame exports as PNG, SVG, GeoJSON, Universal VTT or a Foundry scene with
walls, with a player version that hides the Keeper's notes.

Phase 8 adds the assistant: bring your own Anthropic key and ask in plain
words. It reads the region through summaries, area descriptions, feature
search and map snapshots, and edits through the same commands as the
editor: year, spec, facilities, drawing, brushes, renames, notes and
regeneration. Every tool call is a card with its own undo, usage and cost
are shown, and fifty scripted requests run in CI against recorded
responses.

Phase 9 gives every region one history: populations are anchored to a design
year, and the year slider moves along that history instead of re-rolling it,
so buildings keep their built years, lots rebuild when zoning changes, towns
that decline empty from the edges, and fires, storms and floods leave their
marks. Buildings carry a condition from sound to ruin, a timeline player
plays the years, buildings extrude in 3D, and any frame exports as a glTF
model.

Phase 10 opens it up: a headless engine package shared by the browser, a
`citygen` command line (new, generate, export, directory, import) and an MCP
server that gives Claude Desktop, Claude Code or any MCP client the same
tools as the in-app assistant; OpenStreetMap and heightmap import; culture
packs and feature types as JSON plugins with an authoring guide; an
installable, offline-capable app; and opening documents from a URL. Every
generated building has floor plans (rooms, doors, windows, stairs, by use
and era) for handouts and virtual tabletops, and a gallery of example
regions, community packs and share links rounds it off.

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
