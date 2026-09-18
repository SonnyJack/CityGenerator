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

The project is at the **design stage**. Start here:

- [docs/DESIGN.md](docs/DESIGN.md) — architecture, data model, pipeline,
  placement engine, rendering, editor, LLM integration.
- [docs/ROADMAP.md](docs/ROADMAP.md) — phases, deliverables, acceptance criteria.
- [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) — decisions taken, questions
  still open, and where suggested features land.
