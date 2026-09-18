# CityGenerator — Roadmap

Status: **Draft v0.3**. No calendar estimates by owner request. Phases are
ordered by dependency and by risk: the riskiest architectural pieces
(metropolitan-scale lazy generation and MapLibre rendering) are proven first.
Every phase ends with a deployed site on GitHub Pages so there is always
something to try, and each phase lists acceptance criteria that are testable in
CI or by a reviewer.

| Phase | Theme                                   | Outcome                                                                                             |
| ----- | --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 0     | Foundation                              | Repo, CI, empty editor deployed, engine skeleton, document format v2                                |
| 1     | Terrain, tiles, rendering               | Region-scale terrain rendered by MapLibre through in-browser tiles; ink spike                       |
| 2     | Settlements, districts, classic town    | Organic towns with walls, wards, streets on terrain; lazy blocks; reference parity                  |
| 3     | Years, society, modern streets          | Year-based eras, wealth/density fields and overlays, road hierarchy, mixed-era rings                |
| 4     | Editor                                  | Full editing: draw, edit, brushes, freeze, regenerate-in-scope, annotations, autosave               |
| 5     | Rail and tram                           | Regional and settlement rail, stations, spurs, yards; tram lines and streetcar suburbs              |
| 6     | Placement engine, ports, industry       | Generic placement, ports by era, dry docks, industry, institutions, fill passes                     |
| 7     | Naming, POIs, directory, themes, export | Culture packs, businesses and residents, period/Sanborn themes, PNG/SVG/GeoJSON/VTT, handout frames |
| 8     | LLM assistant                           | Chat drawer, tools over the command API, BYOK, evals                                                |
| 9     | Timeline, 3D, condition                 | Growth scrubber, extrusion view, decay/flood/fire overlays                                          |
| 10    | Ecosystem                               | MCP server and CLI, plugin/custom feature authoring, OSM/DEM import, PWA, gallery, docs             |

Milestones: `v0.1` after Phase 1, `v0.2` after Phase 2, `v0.3` after Phase 3,
`v0.5` after Phase 6, `v0.8` after Phase 8, `v1.0` after Phase 9 plus a tuning
pass across all presets and eras.

---

## Phase 0 — Foundation (done)

- [x] MIT `LICENSE` (copyright "CityGenerator contributors").
- [x] `CONTRIBUTING.md` with the clean-room policy; ADR folder seeded with the
      decisions in DESIGN §15.
- [x] pnpm monorepo: `apps/web`, `packages/core`, `packages/tiles`,
      `packages/themes`, `packages/editor`, `packages/features`.
- [x] Vite + React 19 + TypeScript strict + ESLint + Prettier + Vitest +
      Playwright; Tailwind; Zustand.
- [x] GitHub Actions: `ci.yml` (lint, format, typecheck, unit, build, e2e on
      Chromium/Firefox/WebKit), `pages.yml` (build and deploy `main`), PR
      preview artifacts. The repository's Pages source must be set to
      "GitHub Actions" once, in Settings → Pages.
- [x] `core`: sfc32 PRNG with path-derived named streams and tile/block seeds;
      stable content hashing; `MapDocument` v2 schema (Zod, JSON Schema
      export) with a migration framework and a v1→v2 migration; stage runner
      with input hashing, memoisation, LRU eviction and cancellation; synthetic
      CRS helpers; a placeholder `regionOutline` stage; a determinism fixture.
- [x] `editor`: command schemas, pure `applyCommand`, `CommandBus` with
      undo/redo by inverse JSON Patch.
- [x] `tiles`: `TileSource` (geojson-vt + vt-pbf) serving MVT from model
      layers. `themes`: `atlas` and `ink` palettes compiled to validated
      MapLibre styles. `features`: typed registry and four era profiles.
- [x] `apps/web`: MapLibre map fed by a `citygen://` protocol from the engine
      worker (comlink); document store; IndexedDB autosave; JSON import/export;
      undo/redo; name, seed and year controls; a window test API.

Acceptance (met): merging to `main` deploys; the determinism test hashes the
fixture identically in Node and in the browser (`FIXTURE_GOLDEN_HASH`); a
round-trip test exports and re-imports a document unchanged; five Playwright
tests pass in Chromium (CI also runs Firefox and WebKit).

## Phase 1 — Terrain, tiles and rendering (done)

- [x] Base heightmap: seeded simplex fBm with domain warping blended with preset
      shape functions (plains, coast, bay, river valley, hills, archipelago,
      delta, estuary); imported heightmap; base cell size chosen for ~768 cells
      on the long side (30 m at 20 km, 80 m at 60 km).
- [x] Hydrology: priority-flood depression filling, D8 flow and accumulation
      (ordered by the flood, no sort), stream-power erosion passes, basin
      selection (a wetness-scaled number of the deepest basins stay as lakes,
      the rest become flat valley floors), river reaches with width and order,
      sea with bathymetry deepening away from the coast.
- [x] Derived rasters: slope, aspect, distance to water and to the sea.
- [x] Land cover (R2) from 13 biome packs: water, snow, rock, marsh, mangrove,
      forest, farmland, open, sand; polygonised per class.
- [x] Contour extraction with an in-house marching-squares implementation
      (oriented segments, ring stitching, holes), smoothing and simplification;
      contour interval chosen from the vertical range.
- [x] Terrain-RGB DEM tiles rendered lazily per tile from bicubic base samples
      plus band-limited detail noise (edge-consistent by construction), encoded
      with an in-house PNG encoder; MapLibre hillshade, colour relief and 3-D
      terrain from the same tiles.
- [x] Tile builder with per-layer zoom bands behind the custom protocol;
      versioned and cancellable.
- [x] Theme compiler: atlas and ink themes with hillshade, elevation tint,
      land cover, water, rivers (metre widths), contours, graticule and
      authored layers; ink patterns described as data and rasterised at runtime.
- [x] **Ink spike**: sketch displacement (two amplitude bands by zoom) plus
      hatched water, dotted woods, ruled fields and cased coastlines. Verdict:
      clearly hand-drawn in spirit and acceptable as the baseline; MapLibre is
      confirmed as the renderer (no PixiJS fallback needed). Refinements queued
      for later phases: tree symbols instead of dots, paper texture, label
      typography.
- [x] Generate dock with region, terrain, biome and view parameters; theme
      switch; layer toggles; 3-D terrain toggle; six-seed variations strip
      rendered from coarse terrain previews.

Acceptance (met): 60 km region terrain in 1.5 s in Node and a 20 km region
in 1.9 s end to end in the browser (terrain 1.4 s, land cover 0.4 s, tiles
20 ms); vector tiles build in well under 80 ms; no seams at DEM tile edges
(unit-tested); ink spike signed off as above. Golden hashes guard the terrain
stage and the cross-engine fixture.

## Phase 2 — Settlements, districts and the classic town (done, one item deferred)

- [x] Settlement siting (region stage R3): explicit specs (with pinned sites)
      or a policy-drawn set; candidates scored on flatness, water access,
      centrality, coastal/river wants per kind, and separation; radius from
      population and an era-dependent urban density.
- [x] Town stage: sunflower-spiral patch sites, two Lloyd relaxations, bounded
      Voronoi (vendored Delaunator 4.0.1 with a guard ring), patches clipped to
      the coast through a fine local mask and the in-house marching squares,
      steep patches excluded from the core.
- [x] Curtain wall as the union boundary of inner patches (edge counting on
      shared Voronoi vertices), gates spread by angle on land, towers; walls
      when the year is 1700 or earlier (or the settlement asks for them).
- [x] Arteries from gates to the centre by Dijkstra over patch edges with slope
      cost and reuse discount; outward roads from gates; every other inner
      patch edge a minor street.
- [x] Zone profiles for the reference's ward set with location scoring
      (plaza, castle, cathedral, market, military, park, merchant, patriciate,
      craftsmen, slum, gate wards, farms).
- [x] **Block boundary**: every buildable patch becomes a block recipe (ring
      inset by the street half-width, ward, seed). Lazy block generation:
      recursive lot splitting across the oriented box with jitter, interior lots
      left as courtyards, buildings inset per ward with floors and kinds.
      `BlockTiler` generates blocks on demand into an LRU cache and encodes them
      straight into the tile (direct MVT encoding with clipping), from zoom 13
      (buildings) and 14 (parcels).
- [x] Regional roads (R5): minimum spanning tree plus short extra links,
      routed by A* over the base raster with slope cost, rivers as bridges, sea
      and lakes impassable, trimmed at the built-up edge; roads out to the
      region edge from the largest settlement.
- [x] Rural fill: farm wards around settlements and hamlets as a settlement
      kind. Field subdivision of farmland polygons and country lanes move to
      Phase 3 alongside the modern zone profiles.
- [x] Both themes style patches by ward, streets by class with casings (atlas),
      walls, gates, regional roads, bridges, buildings and parcels; settlement
      markers at region zoom.
- [x] Settlements panel: automatic (policy count) or explicit list with kind,
      population and name; live stats per settlement.
- [ ] District labels: deferred to Phase 7 with the glyph atlas (MapLibre text
      needs glyph PBFs, which the static site must bundle).

Acceptance: golden-hash tests for the town stage; a 20 km region with a port
town and two villages generates in about 2.1 s in the browser (settlements
50 ms, roads 250 ms); tiles with lazy buildings build in 20–40 ms; a
reviewer-style render of a 12,000-person walled town (plaza, cathedral,
castle, market wards, gate suburbs, courtyard blocks) was checked during the
phase. The 40 km / ten-village performance check moves to Phase 3 together
with the modern street patterns, which change the block count materially.

## Phase 3 — Years, society fields and modern streets (done, items deferred)

- [x] Era profiles for 1100, 1400, 1650, 1780, 1850, 1890, 1925, 1955, 1985
      and 2020 with ring street pattern, block sizes, street widths, urban
      density, transport flags, walls and zone weights; numeric fields
      interpolate between profiles; a year slider with the era name.
- [x] Wealth and density rasters (region stage R4) from settlement proximity,
      flatness, elevation advantage, waterfront amenity, the upwind side of
      town, flood risk and noise, shifted by era and spread by inequality;
      class polygons for both fields; opt-in overlays with legends in both
      themes; society sliders (inequality, baselines, contrasts).
- [x] Growth rings: ring extents from a growth curve between the founding
      year and the current year; the organic core covers the pre-grid eras;
      each later ring is a rotated grid in its era's pattern (Georgian grid,
      streetcar long blocks, post-war suburban thinning, late-modern
      cul-de-sac blocks), clipped to land and slope, cut by radial arteries
      that snap to the old gates, with collector and local streets and a ring
      road in motorway eras for large settlements.
- [x] Modern zone profiles (CBD, retail strip, rowhouse, tenement, streetcar
      suburb, garden suburb, suburb, cul-de-sac, apartment, tower estate,
      warehouse) chosen from era, wealth class, density class, artery
      frontage and waterfront; the old town becomes CBD, retail and
      tenements or apartments in modern years; block generation honours
      per-profile lots, setbacks, floors and courtyard rules.
- [x] "Why is this here?" inspector: click anywhere for elevation, slope,
      ground, wealth and density (value and class), settlement and zone with
      the score explanation recorded by the town stage.
- [ ] Deferred to Phase 5/6: contour-aligned local streets, cuttings and
      tunnels on major roads (with rail), field subdivision and country lanes.

Acceptance (met): overlays show coherent gradients (dense centres, wealth on
the hills, waterfront and the upwind side, poverty by flood-prone low ground)
on the seeds checked; the same seed at 1650, 1925 and 1985 keeps its old
core and adds rings without moving the centre; a 40 km region with a city
and ten villages runs the eager stages in 2.6 s in Node (terrain 1.8 s,
society 0.5 s, eleven towns 50 ms, roads 190 ms) and lazily generates 660
blocks.

## Phase 4 — Editor

- [x] Tool controller in `@citygen/editor` (framework-agnostic, unit and
      fuzz tested): navigate, select (click, shift-click, box), line, polygon,
      rectangle, point, brush and annotate tools; vertex handles with drag,
      insert (double-click a segment) and remove; move by drag or arrow keys;
      rotate, scale, mirror; snapping to vertices, angles (15°, or Shift) and
      a metre grid (Alt bypasses); Escape/Enter/Delete; split, join and
      offset helpers.
- [x] Draw: streets, railways, tram lines, canals and walls with kind and
      metre width; buildings, facilities, zones (by ward), vegetation and
      water polygons; rectangle buildings; points of interest.
- [x] Brushes: terrain raise/lower/smooth/flatten/water (applied in the
      terrain stage before hydrology, so rivers and coasts follow), wealth
      and density (applied to the society fields), zone paint (overrides
      generated wards), erase (authored features) and re-roll (blocks under
      the stroke draw from a salted seed).
- [x] Authored vs. generated: authored features render from a main-thread
      GeoJSON source so edits are instant; generated buildings under authored
      buildings, zones, streets and rails are dropped; a generated building,
      street or block can be frozen into an authored feature (kept across
      reseeds and year changes) or removed (a `suppress` override).
- [x] Regenerate the whole layout or one settlement with `reseed` overrides
      (terrain and authored features stay put); reset clears them.
- [x] Annotations: labels, markers and GM notes as DOM markers (draggable,
      no glyph atlas needed), handout frames as dashed rectangles; edited in
      the properties panel; a layer toggle hides them.
- [x] Properties panel (name, kind, width, floors, stroke radius/amount,
      transforms), history menu (jump to any state), recent documents
      (IndexedDB, most recent first, forget), layer toggles for authored
      features, brush strokes and annotations.
- [ ] Deferred: lasso and by-query selection, alignment guides, vegetation and
      year brushes, layer lock/opacity/reorder, history thumbnails, derived
      caches for instant reopen, arrows as a drawn annotation tool.

Acceptance (met): Playwright covers each tool (line, rectangle + select +
move + undo, terrain and wealth brushes + erase, annotations, freeze and
remove, regenerate and reset, recent documents and history); a fuzz test runs
random command sequences and random pointer sequences through every tool and
checks the document stays valid, the selection stays consistent and undo
restores every intermediate state; the e2e "hand-drawn street survives a
reseed and a year change" passes.

## Phase 5 — Rail and tram

- [x] Rail graph: served places by population and year (towns from the 1840s,
      villages from 1900, closures after 1965 leave disused alignments); MST
      links with a sea-crossing penalty; mainlines between the large places
      and out to the region edges through the hub (0–4, from the spec);
      branches to the rest. Each link routed on the terrain with a ruling
      gradient (2 % mainline, 3 % branch, 3.5 % spur) and eased to a minimum
      curve radius (300 / 180 / 120 m); a vertical profile within the gradient
      cap classifies every run as surface, cutting, embankment, viaduct or
      tunnel, with portals; rivers are crossed on viaducts.
- [x] Stations at the edge of each old core facing the network (central,
      town, halt), suburban stations along the lines inside the built-up area
      from 1880; goods yards beside stations (1840–1965, later for big cities
      only); marshalling yards for cities with ladder tracks joining the line
      at both throats, a steam-era roundhouse, turntable, coaling stage and
      water tower, a diesel depot after 1960 and an intermodal terminal from
      1970; freight spurs to the docks of ports and the downwind (industrial)
      edge of cities; subways under metropolitan cores after 1900 and elevated
      viaducts in 1890–1950.
- [x] Trams (per settlement, on its streets): lines radiate from the central
      station along arteries and collectors to termini in the outer rings in
      the eras with trams and towns above 15 000 people, with stops every
      350 m and a depot at the longest line's terminus.
- [x] Level crossings, rail bridges and underpasses where tracks meet town
      streets and regional roads; rail corridors and yards feed the society
      stage as nuisance so wealth falls beside the tracks.
- [x] Rendering across zooms in both themes: mainlines heavy with sleepers at
      high zoom, branches lighter, disused faint and dashed, tunnels and
      subways dashed, viaducts and elevated lines with casings, cuttings as a
      pale band, yards as ladders; stations by kind; yards, sheds and depots as
      footprints; crossings and portals as marks. Networks panel (rail on/off,
      mainline count), rail and station layer toggles, rail statistics.
- [x] Siting fix found on the way: settlements no longer land on islets; a
      site must be on the mainland (or an island several times its area)
      with dry ground around it.
- [ ] Deferred: streetcar suburbs biased around tram termini, junction
      geometry (crossovers, flying junctions), sidings for individual
      industries, tram networks that share track between lines explicitly.

Acceptance (met): on a hills preset with 0.7 relief every track segment stays
within its class cap (max 3.5 % on spurs, 2 % on mainlines); yard ladders start
and end on the host line; a 1925 metropolis gets a central station, suburban
stations, a goods yard, a marshalling yard with roundhouse and turntable, an
industrial spur, a subway core and a tram network with stops and a depot; the
region statistics report track length by class, stations, yards, tunnels,
viaducts, maximum gradient and tram lines; a 24 × 18 km hills region with five
settlements and two mainlines routes in about 0.9 s.

## Phase 6 — Placement engine, ports, industry and institutions

- [ ] Placement engine complete: orientation modes, connector requests fulfilled
      by S5, degrade-and-report, scale compression.
- [ ] Ports by era: finger-pier harbour, break-bulk quay with transit sheds and
      cranes, container terminal with yard grid, gate, breakwater, Ro-Ro, tanks.
- [ ] Fishing harbour with cannery and boat yard; marina.
- [ ] Shipyard and dry dock: graving dock, caisson, pump house, slipways,
      building berths; floating dock; modern halls.
- [ ] Industry: heavy, gasworks, mills (water and textile), light/logistics,
      power plant, refinery, brewery, tannery.
- [ ] Institutions: campus, hospital, asylum/sanatorium, prison, military base,
      cemetery, waterworks, observatory; airport after 1925.
- [ ] Fill passes complete at block, settlement and region levels; wasteland
      reporting.
- [ ] Custom feature types in the document.

Acceptance: a `bay` preset at 1925 places a break-bulk port with rail on the
quay, a yard behind it, gasworks and warehouses nearby and affluent housing on
the far shore on 8 of 10 seeds; the same seed at 2020 replaces the quay with a
container terminal; wasteland < 3 % of buildable land.

## Phase 7 — Naming, POIs, directory, themes and export

- [ ] Culture pack framework (naming grammars with transliteration, street
      and block conventions, building kinds, religious/civic kinds, colonial
      overlays) and the first eight packs: `newEngland`, `england`, `france`,
      `germanyCentralEurope`, `iberia`, `egyptLevant`, `china`, `japan`; label
      placement via MapLibre. Remaining packs from DESIGN §7 follow as data
      contributions with a reference gallery each.
- [ ] Remaining biome packs from DESIGN §7.
- [ ] Addresses; business and resident directory for every building; search.
- [ ] Amenities and POIs by era (church, chapel, school, pub, corner shop,
      police, fire, post office, bank, cinema, boarding house, telephone
      exchange, funeral parlour…).
- [ ] Themes: `period-1920s`, `sanborn` (material and use colouring), `blueprint`,
      `dark`, `print`.
- [ ] Export: PNG (offscreen MapLibre, DPI, presets for Foundry/Roll20 scenes and
      handouts), SVG (`svg-export`), GeoJSON, Universal VTT with walls from
      simplified, merged building outlines (frame-limited, segment cap with
      warning and solid-block fallback), Foundry scene JSON with the same
      walls, player export, handout frames re-export.

Acceptance: exported SVG and PNG of the same frame match in a visual test;
directory export lists every non-residential building with a name; a Keeper
can produce a player handout of a harbour district with GM notes hidden; a
Universal VTT export of a dense 1925 downtown frame of 500 × 500 m loads in
Foundry with line of sight working and under 4,000 wall segments; a 1925
Cairo and a 1925 Boston from the same seed differ in street pattern, building
kinds and names.

## Phase 8 — LLM assistant

- [ ] Anthropic adapter with the official SDK: streaming, adaptive thinking,
      refusal fallbacks, prompt caching of summaries and tools; BYOK settings
      with cost display.
- [ ] Tools from DESIGN §11.3 generated from command and query schemas with
      strict schemas; `render_snapshot` for vision questions.
- [ ] Assistant drawer: tool cards with inline undo; automatic region and
      focus summaries; context trimming.
- [ ] Naming and flavour text on `claude-sonnet-5` with structured output.
- [ ] Evaluation set of 50 scripted requests (questions, single edits,
      multi-step edits, drawing) with expected outcomes; CI against recorded
      responses, scheduled live runs.

Acceptance: all eval requests produce valid commands or correct answers; no
tool can emit unvalidated geometry; invalid key and network failures produce
clear messages without crashes.

## Phase 9 — Timeline, 3D and condition

- [ ] Buildings and networks carry built/demolished years; the year scrubber
      shows a coherent history of one seed.
- [ ] Extrusion 3D view with terrain; glTF export of a frame.
- [ ] Condition brush and year-based decay; flood (raise sea level), fire and
      storm overlays; abandonment for shrinking settlements.

Acceptance: scrubbing 1850 → 2020 on one seed shows growth without flicker of
unrelated areas; a flooded harbour district renders correctly in all themes.

## Phase 10 — Ecosystem (ongoing)

- MCP server and `citygen` CLI over the same commands.
- Feature-authoring guide; plugin registry for community feature types and
  culture packs.
- OSM and DEM import as a starting document.
- PWA offline install; gallery of shared documents (gists); localisation.
- Building interiors (floor plans from footprint, floors, use and era) as a
  stretch project.
