# CityGenerator — Roadmap

Status: **Draft v1.0-rc**. No calendar estimates by owner request. Phases are
ordered by dependency and by risk: the riskiest architectural pieces
(metropolitan-scale lazy generation and MapLibre rendering) are proven first.
Every phase ends with a deployed site on GitHub Pages so there is always
something to try, and each phase lists acceptance criteria that are testable in
CI or by a reviewer.

| Phase | Theme                                   | Outcome                                                                                                             |
| ----- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 0     | Foundation                              | Repo, CI, empty editor deployed, engine skeleton, document format v2                                                |
| 1     | Terrain, tiles, rendering               | Region-scale terrain rendered by MapLibre through in-browser tiles; ink spike                                       |
| 2     | Settlements, districts, classic town    | Organic towns with walls, wards, streets on terrain; lazy blocks; reference parity                                  |
| 3     | Years, society, modern streets          | Year-based eras, wealth/density fields and overlays, road hierarchy, mixed-era rings                                |
| 4     | Editor                                  | Full editing: draw, edit, brushes, freeze, regenerate-in-scope, annotations, autosave                               |
| 5     | Rail and tram                           | Regional and settlement rail, stations, spurs, yards; tram lines and streetcar suburbs                              |
| 6     | Placement engine, ports, industry       | Generic placement, ports by era, dry docks, industry, institutions, fill passes                                     |
| 7     | Naming, POIs, directory, themes, export | Culture packs, businesses and residents, period/Sanborn themes, PNG/SVG/GeoJSON/VTT, handout frames                 |
| 8     | LLM assistant                           | Chat drawer, tools over the command API, BYOK, evals                                                                |
| 9     | Timeline, 3D, condition                 | Growth scrubber, extrusion view, decay/flood/fire overlays                                                          |
| 10    | Ecosystem                               | MCP server and CLI, plugin/custom feature authoring, OSM/DEM import, PWA, gallery, docs                             |
| 11    | Utilities                               | Water and gas mains, power lines, sewers, pipelines and canals from the works, by era                               |
| 12    | Tuning pass                             | Headless sweep over presets, eras, cultures and edge cases; the fixes it forced                                     |
| 13    | Terrain fit                             | One shoreline for every test; routes on land; towns shaped by a growth fill; streets and wards that read the ground |

Milestones: `v0.1` after Phase 1, `v0.2` after Phase 2, `v0.3` after Phase 3,
`v0.5` after Phase 6, `v0.8` after Phase 8, `v1.0` after Phase 9 plus a tuning
pass across all presets and eras (`pnpm sweep`, see Phase 12).

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
- [x] District labels: delivered in Phase 7 with the glyph atlas.

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
- [x] Contour-aligned local streets (Phase 13) and cuttings, embankments and
      tunnels on the regional roads: a road keeps a ruling gradient of 8 %
      on the profile the railways use, and each run of one earthwork is a
      feature of its own, styled per theme and in the SVG export.
- [x] Field subdivision and country lanes: every farm holding in the belt
      is cut into strip fields across its long axis with a hedge on each
      boundary (a `hedges` layer, thin and muted per theme, in the SVG and
      GeoJSON), and a holding no road or artery touches gets a `lane` along
      the patch edges to the nearest of them, lanes sharing their way.

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

- [x] Placement engine (`core/placement`): feature types declare a footprint
      by size, hard constraints, weighted soft scorers, an orientation mode
      (free, along the coast, along the railway, tangential to the town,
      into the wind, along a river), connectors, nuisance, a reserved ward and
      a layout. Requests are placed pinned first, then largest first, from
      shore, river, annulus or region-grid candidates; on failure the engine
      shrinks the footprint twice and relaxes the scorers before reporting
      "could not place X at Y because Z". Scale compression shrinks large
      footprints (default 0.6, per type) and the inspector shows both sizes.
- [x] Library (21 types) with era variants: port (finger piers ≤ 1900,
      break-bulk quay with transit sheds, cranes and rail on the quay
      1900–1965, container terminal with berths, gantry cranes, yard grid,
      gate, Ro-Ro ramp, tanks and breakwater after), fishing harbour, marina,
      shipyard with graving dock, caisson and pump house, heavy industry,
      gasworks, mill (water then textile), logistics park, power station,
      refinery, brewery, tannery, campus, hospital (pavilion plan then
      block), asylum, prison (radial then block), military base, cemetery,
      waterworks, observatory, airport (grass field and hangars, then
      runways aligned to the wind).
- [x] Defaults per settlement from kind, population and year; explicit
      requests on settlements or the region; `remove` and `pin` overrides
      drop or fix any facility; custom feature types in the document
      (footprint, placement rules and parts) are placed like built-ins.
- [x] Connectors: rail spurs from the facility's rail edge to the nearest
      track and access roads to the town, routed on the terrain.
- [x] Facilities run after rail and before the society and town stages: their
      nuisance shapes the wealth field and the towns reserve their land
      (patches take the facility's ward and draw no buildings; rail yards
      likewise).
- [x] Rendering of footprints and parts in both themes (quays, piers, sheds,
      cranes, tanks, gasholders, chimneys, docks, slipways, runways, aprons,
      grounds, graves, walls); Facilities panel (defaults on/off, compression
      on/off, list with remove, failures, restore), per-settlement facility
      requests, inspector with pin-here and remove; wasteland statistic.
- [x] Block-level fill inside facility grounds: the free ground of a works,
      a port or a transport facility gets stores, sheds, workshops and
      offices on a lattice, off the laid-out parts and on land, as `shed`
      parts with interiors like any other. Region-level fill reporting: the
      engine stats carry land cover by class in km² and the woods, commons
      and farmland within twice each town's radius.
- [ ] Deferred: a dedicated facility-drawing tool (authored facility
      polygons already work).

Acceptance (met with one caveat): on the `bay` preset at 1925 a break-bulk
port with rail on the quay, a marshalling or goods yard behind it, gasworks
and warehouses is placed on 4 of 5 seeds tested (the fifth has no shore
within reach of the town that is flat enough); at 2020 the same seed swaps
the quay for a container terminal; every facility gets its own land (no
footprint centres overlap). Wasteland is measured and shown (buildable land
inside the built-up radius farther than 25 m from any patch, facility or
yard); it is about 15 % on the default coast region (18 % in the port
town, 8 % in the mill town), so the 3 % target is not yet met and is carried
into the fill work of Phase 7.

## Phase 7 — Naming, POIs, directory, themes and export (done, items deferred)

- [x] Culture pack framework: a schema for naming grammars (given and family
      names; settlement, street, district, water and business patterns with
      `{token}` expansion; street suffixes by class; quarter names by kind),
      conventions (early street pattern and the year the modern pattern
      takes over, block-size scale, building kinds with display labels,
      religious and civic kinds, materials, transport and wall habits) and an
      optional colonial overlay (a second pack mixed in after a given year).
      Eight packs ship: `newEngland`, `england`, `france`,
      `germanyCentralEurope`, `iberia`, `egyptLevant`, `china`, `japan`. The
      region has a culture and every settlement can override it.
- [x] Era profiles are culture-aware: the pre-modern ring pattern, block
      sizes and walls come from the pack (a 1780 Cairo grows an organic
      medina where Boston grows a Georgian grid), the modern eras converge.
- [x] Naming stages: settlements and rivers per region; streets chained into
      named ways (shared nodes, direction continuity, class rank), districts
      (the old-town core, special-ward quarters, ring sectors) and quarter
      names per town. Names are unique per scope and deterministic.
- [x] Addresses (odd and even sides along each way), building kinds with
      culture labels, materials by era band, uses and amenities by era and
      ward (church, chapel, school, pub, corner shop, police, fire, post
      office, bank, cinema, boarding house, telephone exchange, funeral
      parlour…), business names from the pack's grammar, household names for
      residences. The inspector shows the building's name, kind, material,
      floors and address; the directory panel lists every premises of a
      settlement (or the region) with search and a businesses-only filter,
      and exports CSV.
- [x] Labels in every theme with vendored Open Sans glyph PBFs (settlement,
      district, street, river, facility, station, premises and annotation
      labels), shown by zoom; a `labels` and a `pois` layer group.
- [x] Themes: `period1920s` (sepia survey), `sanborn` (buildings coloured by
      material, use tints), `blueprint` (outline-only on blue), `dark`,
      `print` (grey, halftone-free, for photocopies), alongside `atlas` and
      `ink`.
- [x] Export package: frame model from the worker (buildings generated for
      the blocks that touch the frame), SVG renderer, GeoJSON (metres, planar
      CRS declared), directory CSV, walls merged along shared edges and
      capped at 4,000 segments with a warning and a solid-block fallback,
      Universal VTT 0.3 (`.dd2vtt` with the PNG embedded) and Foundry scene
      JSON with the same walls. The web app renders PNG with a hidden
      MapLibre map (`preserveDrawingBuffer`), with Foundry, Roll20 and
      300 dpi handout presets, and a player option that hides GM notes and
      overlays. Frames: the current view or any handout-frame annotation.
- [ ] Deferred: the remaining culture packs from DESIGN §7 (data
      contributions with a gallery each), transliteration tables, a
      pixel-level SVG-versus-PNG comparison (the e2e test checks both exports
      of the same frame for content), streetcar-suburb bias by culture. The
      wasteland target carried from Phase 6 (block-level fill inside facility
      grounds) is done.

Acceptance: the directory of the default region lists about 11,500 premises,
every non-residential one with a name and most with an address; a player SVG
and GeoJSON of a district hide a GM note that the Keeper's export shows; a
Universal VTT export of a 500 × 500 m 1925 downtown frame carries under 4,000
line-of-sight segments and its PNG is not blank; switching the region to the
Japan pack renames the region and its settlements; a 1925 Cairo and a 1925
Boston from the same seed differ in street pattern, block count, building
kinds, materials and names (unit test). Labels render from the bundled glyphs
(the e2e test watches the font requests). The full suite is 125 unit tests
and 28 end-to-end tests.

## Phase 8 — LLM assistant (done, items deferred)

- [x] `@citygen/assistant`: a DOM-free package over the official
      `@anthropic-ai/sdk` (browser opt-in, streaming, adaptive thinking,
      effort, prompt caching on the system prompt and the tool list). The
      client interface is small (`stream`, `structured`) so a scripted client
      replays recorded turns in tests and the evaluation set. SDK errors map
      to plain messages (bad key, network, rate limit, server, cancelled);
      a `refusal` stop reason ends the turn with a notice and no change.
      BYOK settings: the key lives in memory and, only if the user opts in,
      in localStorage; it is never written to the document. Usage and an
      estimated cost (editable price table) are shown per session.
- [x] Twenty-three tools generated from zod schemas with strict JSON schemas
      (optionals nullable, every property required, constraints kept for
      local validation): region and settlement summaries, describe_area,
      find_features, render_snapshot (the hidden export map as an image
      block), get/patch_spec, set_year, set_theme, regenerate (region,
      settlement, area), draw, remove_feature, freeze/unfreeze,
      place_feature, move_feature, brush, annotate, name_features,
      add/remove_settlement, undo/redo. Every mutation goes through the
      command bus; out-of-region or non-finite geometry, wrong geometry
      kinds and unknown ids come back as tool errors the model can read.
- [x] Assistant drawer: streaming replies with a thinking fold, a card per
      tool call with an inline undo (jumps the shared history back to the
      point before the call), warnings, cost line, settings (key, model,
      effort, thinking, focus settlement). Each conversation is primed with
      the region summary and the focused settlement; old tool results are
      trimmed to a stub and images dropped once six newer results exist.
- [x] Renames land in the engine: `setProperty` overrides rename
      settlements, facilities, ways (and their streets) and buildings.
- [x] Flavour text on `claude-sonnet-5` with structured output (title,
      description, hooks, rumours, NPCs) from the drawer's Flavour button.
- [x] Evaluation set: 50 scripted requests (12 questions, 18 single edits,
      12 multi-step edits, 8 drawing requests, one deliberately invalid)
      with expected tools, document checks, result and answer substrings.
      CI replays recorded responses through the real tool executor and
      command bus against an in-memory host; the package's `eval:live` script runs them against the API and can
      re-record; a weekly workflow runs live when the repository enables it.
- [ ] Deferred: the recordings are authored by hand until a live run
      records real responses (the runner writes them); the server-side
      refusal fallback option from DESIGN §11.2 is not in the SDK, so
      refusals are handled client-side. The MCP server and CLI from DESIGN
      §11.5 were delivered in Phase 10.

Acceptance: all 50 recorded requests produce valid commands or correct
answers (unit test); no tool can emit unvalidated geometry (the executor
rejects non-finite, out-of-region and wrong-kind geometry before the bus,
which validates again); invalid keys, network failures and refusals produce
messages in the drawer without crashing or changing the document (unit and
e2e tests); a scripted conversation in the browser sets the year, renames
the port through the engine, adds a GM note and undoes from a tool card.

## Phase 9 — Timeline, 3D and condition (done, items deferred)

- [x] One seed, one history. The spec carries an anchor year (the year its
      populations describe; `spec.anchorYear`, document version 3) and each
      settlement a growth curve anchored there, or explicit growth points.
      Past ring boundaries, the old town's final extent, walls, gates and
      arteries come from that history rather than from the year, so the
      year slider only adds or removes what was built by then: core patches
      and ring blocks carry a built year from the growth curve, grid cells
      and blocks have stable ids and per-cell randomness, artery cuts are
      bit-identical whatever the newest ring's extent, and modern zoning
      uses a society fixed at the anchor year.
- [x] Buildings carry `built` and `demolished` years. Each lot has a
      history: first built with its block (over the following 25 years),
      rebuilt when the zoning changed (over the following 45 years) and
      after fires; the building standing at the year is the current
      episode, with the year it will be replaced. Streets carry built years
      too; the ring road moves out with the newest ring.
- [x] Condition (0–1) from ward, age, decline, disasters and condition
      strokes, with states sound, worn, derelict and ruin; derelict
      buildings are muted and ruins outline-only in every theme; a building
      age overlay with a legend; the inspector and directory carry the
      values.
- [x] Decline and abandonment: when the population falls below its peak
      (explicit growth points, or a lower anchor population than an earlier
      point), the outermost blocks empty first, dated by the year the decline
      reached them, and their buildings decay to ruins over forty years.
- [x] Disasters on the timeline (`spec.events`): fires destroy the buildings
      they reach (by severity) and the lots rebuild in the zoning of the
      time; storms damage and heal over 25 years; floods reach ground below
      a level for their duration. Overlays in every theme, an events panel
      (add at the map centre in the current year), and assistant tools.
- [x] Timeline player (play from/to with the engine keeping pace) and a
      "make this the design year" action.
- [x] 3D: buildings extruded by their floors on the 3D terrain (a layer
      toggle); glTF binary export of any frame with a terrain mesh from the
      height grid, buildings extruded on the ground, facilities, water and
      per-kind materials.
- [x] Rail lines, stations and facilities carry opening and closing years
      replayed from the settlements' growth histories (a branch opens when
      its village reaches the threshold of its day, a default facility when
      its town's growth first asks for it); a closed default stays as a
      brownfield for forty years, drawn as it stood when it shut. The rail
      stats list the lines with their years; the inspector shows them.
- [ ] Deferred: explicit growth points in the settlements panel (they are
      settable through the spec and the assistant); a textured glTF.

Acceptance: a unit test generates one seed at 1850, 1890, 1925, 1955 and
2020 and checks that every earlier block, street and surviving building is
present later with the same outline and built year (only the ring road moves
and ring arteries lengthen); the browser test does the same for a 700 m
frame of the city between 1890 and 1955 through the export path. A flood
around the harbour renders in all seven themes and damages the buildings it
reaches; 3D buildings render; the glTF export of the harbour frame carries a
terrain mesh and buildings.

## Phase 10 — Ecosystem (ongoing)

- [x] Headless engine (`@citygen/engine`): the pipeline, tiles and queries
      behind one `createEngine()` used by the browser worker, the command
      line and the MCP server, with no DOM.
- [x] `citygen` command line (`@citygen/cli`): `new`, `generate`, `export`
      (SVG, GeoJSON, glTF, directory CSV; frames by settlement or bounds),
      `directory`, `import` (OSM, PNG heightmaps with a built-in decoder)
      and `mcp`. See docs/CLI.md.
- [x] MCP server over the assistant's tools plus document tools (new, open,
      save, get, export), on stdio, with autosave; the same command bus and
      validation as the editor, so `undo` works and documents round-trip.
- [x] OpenStreetMap import (.osm XML and Overpass JSON): highways by class,
      railways and trams, buildings with levels, water, woods, parks,
      industrial land, cemeteries, city walls and named places, projected
      locally in metres; from the toolbar, the CLI and a URL.
- [x] Heightmap import: grey or Terrain-RGB images become the terrain (16-bit
      grid in the document); rivers, coasts and land cover derive from it.
- [x] Plugins: culture packs and feature types as JSON in the document
      (`customCulturePacks`, `customFeatureTypes`), imported from a file or
      URL, replacing built-ins by id; docs/FEATURES.md is the authoring
      guide with complete examples.
- [x] Installable and offline (PWA): manifest, icons and a precaching
      service worker for the app shell, engine worker and fonts.
- [x] Open from URL (a raw gist or any hosted document) from the Open menu.
- [x] Building interiors: floor plans from a footprint, its floors, use and
      era. Room programmes per use (houses, flats, pubs, hotels, banks,
      police stations, schools, libraries, theatres, lodges, offices,
      shops, warehouses, churches), a recursive area partition that keeps
      front rooms on the street, convex decomposition for odd footprints, a
      stair well in the same place on every floor, a spanning tree of doors
      from the front door, windows on outside walls. In the inspector
      (floor selector, SVG per floor, Universal VTT with walls and door
      portals and the plan as the scene image), the `citygen interior`
      command, and the assistant's `floor_plan` tool.
- [x] Gallery: four curated example regions shipped with the app (a 1925
      New England coast, a Nile delta town, a 1650 castle town, a declining
      fishing port with a flood), a community pack index with the guide's
      example pack and type, and share links (`?doc=<url>`) that open any
      hosted document.
- [x] Facility interiors: the buildings inside facilities (warehouses,
      halls, wards, cell blocks, gatehouses, terminals, hangars, brewhouses,
      turbine halls…) have floor plans too, chosen by part name and kind,
      with the front facing the middle of the facility; from the inspector,
      `citygen interior` and the `floor_plan` tool (part ids come with each
      facility in `find_features`).
- [x] Pack registries: a hosted `index.json` of packs and example documents
      (format in docs/FEATURES.md) that the Gallery lists next to the site's
      own, remembered per browser; `citygen packs <url>` lists or adds from
      one headlessly.
- [x] Localisation: the interface in English, French, German and Spanish
      (a picker in the toolbar, remembered per browser; the browser language
      picks the default). Keys are the English strings, dictionaries are
      checked for coverage in CI; generated content (names, room names, use
      labels) stays in the document's own language.
- [ ] Still open: more languages (contributions are one dictionary file
      each); interiors for the generic `building` parts of custom feature
      types beyond the office default.

---

## Phase 11 — Utilities (done)

The networks under and over the streets that a period map or a scenario
needs but a town plan does not draw, as a region stage after the towns and
facilities (`utilitiesStage`), rendered in every theme, exported and
inspectable.

- [x] Water: a trunk main from the waterworks, or from a reservoir the stage
      sites on high ground beyond the built-up area when there is none, to
      the centre; distribution mains under the arteries (and collectors in
      big towns); a water tower on the highest outer street corner of cities
      from the 1880s.
- [x] Town gas from the 1820s: a trunk main from the gasworks and mains under
      the arteries, only where a gasworks stands.
- [x] Electricity from the 1890s: transmission lines on pylons from the power
      station, or from a grid supply at the region edge when there is none,
      chained town to town along a minimum-length tree, with a substation at
      the edge of each served town facing the source; the service threshold
      falls with the years (3 000 people, then 1 000, then 300).
- [x] Sewers from the 1860s, GM-only: a trunk sewer routed downhill from the
      centre to an outfall on the nearest water, branches under the arteries,
      a sewage works before the outfall from the 1920s. Hidden on player
      exports and in the player style.
- [x] Pipelines from the 1900s: refinery to the nearest port (or the sea).
- [x] Canals (opt-in, `networks.water.canals`): a canal-age town away from
      navigable water gets a cut to the nearest river or sea with a basin in
      town and locks where the ground changes; disused from 1900.
- [x] Tiles (trunks from zoom 9, distribution from 13), a `utilities` layer
      group and styling in every theme (dashed mains per network, solid power
      lines with pylon dots, dotted sewers, canals as water), SVG and GeoJSON
      export, inspector "Services" row, `find_features` kind `utility`,
      region summary and statistics, a Networks panel toggle and stats line.
- [ ] Deferred: aqueducts on arches for pre-industrial cities, district
      heating, telephone and telegraph lines, and utility failures as events.

---

## Phase 12 — Tuning pass (done)

`pnpm sweep` generates every terrain preset at eight years with the cultures
and biomes in rotation, plus edge cases (a 3 km region, the year 1100, the
year 2100, a drowned coast, a dead-flat plain, a rugged upland, a 900 000
metropolis in a 16 km region, a declining port after a flood, a 40 km
region), then runs the queries the app and the assistant use (find,
summary, directory, inspect, interiors, export, a tile) and reports
failures, budget overruns and invariant breaches (rail gradients, wasteland,
facility failures, settlements without blocks, no premises).

- [x] Siting never loses an explicit settlement: three passes relax the
      room-to-grow and separation rules for a settlement too big for its
      region, and the last pass takes any land.
- [x] A settlement on rugged ground keeps a built core: when the slope cut
      leaves fewer patches than a core needs, the flattest patches within
      the radius are built instead of everything turning to fields.
- [x] Synthesised settlements may take an island half again their size
      (ports do) but are dropped rather than sited on a sliver of coast;
      explicit ones are always placed.
- [x] Placement degrades one step further before reporting: half size,
      searched farther out (small islands, cramped valleys); a default
      facility outside its type's years (a mill town after the mills closed)
      is simply not requested rather than reported as a failure.
- [x] Facility failures in a region too small for a city's default works are
      reported, not counted as a breach; every other run is clean.
- [ ] Deferred: a browser-side sweep of every theme at every zoom for
      rendering budgets; per-culture visual review of the generated names.

## Phase 13 — Terrain fit (done)

Screenshots showed blocks hanging over lakes and bays and roads cutting
coves. The cause was two shorelines: the map draws water from marching
squares contours of the raster (the boundary runs half a cell from the water
cell centres), while the generators tested the nearest cell, so anything
within half a cell of the drawn line was "land" to them. The other cause was
smoothing: Chaikin passes and curve easing pulled a routed line off the land
the router had chosen, and a long straight segment could hop a bay whose
cells the router had never entered.

- [x] One shoreline (`landSampler` in `core/terrain/land.ts`): a bilinear
      sample of the distance-to-water field, minus half a cell, reproduces
      the drawn contour to sub-cell accuracy; an optional setback keeps
      footprints clear of it, and rivers count as water (buildings) or as
      land a road may bridge (routes). Patches, growth rings, blocks,
      buildings and the placement engine all use it; ring streets are
      trimmed to their land runs across an inlet; blocks left under 50 m² by
      the clipping are dropped.
- [x] Routes stay on land (`smoothOnLand`): every smoothed line (regional
      roads, rail including the eased curves and the final resample, spurs,
      access roads, utilities) is checked vertex by vertex and along each
      segment; a wet vertex snaps back to the nearest routed point on land
      and a wet segment gets a land corner or routed point inserted. The
      router no longer cuts a diagonal between two water cells. Endpoints
      are kept, so a quay or a jetty can still end in the water on purpose.
- [x] The engine exposes `landCheck(points, options)` and the sweep asserts
      no building corner over the drawn water and no road or track vertex
      over the sea or a lake, on every run.
- [x] Step 3, the footprint (`core/settlement/footprint.ts`): a town is no
      longer a disc. A cost-weighted fill grows from the centre over the
      buildable ground (land above the sea; slopes cost more from 1 in 20,
      seven times flat ground at 1 in 2.5 and rising; only cliffs are
      impassable; a river costs a bridge) and records
      the area covered when it reached each cell. That area, as the radius
      of a disc, is an _equivalent radius_: on a plain it is the distance
      from the centre, on a coast or in a valley it is the same area shaped
      by the ground. Patches, growth rings, the built year of every block,
      ward scores, the artery ends and the decline order all read it in
      place of the Euclidean distance, so the growth curve, the ring
      boundaries and the timeline keep their meaning; the fill is sized to
      the largest radius the history ever reaches, so a block's shape does
      not depend on the year. The motorway ring road follows the footprint's
      outline. Towns report their extent and the share of steep ground in
      the core.
- [x] Step 4, streets that see the ground (`core/settlement/orientation.ts`):
      each growth ring's grid is turned to the terrain around its inner
      edge, where the ground votes with a quarter-turn angle: the contour
      direction where it slopes, the shoreline direction within 600 m of
      the sea; weak or cancelling votes keep the artery direction. The
      samples are fixed by the ring's inner edge, so the newest ring keeps
      its angle while it grows with the year. On a sloped ring the
      collectors run along the contour and the cross streets climb; any
      minor street steeper than 15 % becomes a flight of `steps` (thin and
      dashed in every theme and the SVG export, named as a lane, never a
      tram route). Artery cuts use the artery's full line so a block cut
      in one year is cut in every year. Siting scores a candidate on the
      land and gentle ground across its eventual footprint (two rings of
      samples and the centre) rather than on the centre cell alone. Rail
      easing keeps a short inlet as a viaduct and follows the routed line
      round a longer one; any track over water is carried. Two stability
      fixes the new sites exposed: the zoning society takes its noise from
      the anchor year's railways and works (so a block's wealth class does
      not flip with the slider), and a sewer outfall is a shore cell the
      trunk can reach (the router may also enter its goal diagonally).
- [x] Step 5, water as a feature: a river through a town is a hard
      boundary. Patches and ring blocks stop at the bank; the two banks are
      separate components of the patch-edge graph, joined only by bridge
      edges (the nearest far-bank vertex across the water, at three times a
      street's cost) that arteries and roads may take, and a radial artery
      in the rings bridges a short span of water and stops at a long one.
      Bridges are town features drawn in the bridges layer, the SVG and the
      GeoJSON, and counted in the settlement stats. Every block within reach
      of the water is clipped back behind a ten-metre quay strip. Wards read
      the terrain: the patriciate takes the high ground and shuns the
      floodplain, slums and craftsmen take the low ground by the river; in
      the rings, works and yards take the floodplain in the industrial city
      and the rich take the hill with the view.
- [x] Fishing quarters as a ward of their own (`fishing`): boats drawn up
      on the shore of a coastal town, the whole shore of a fishing village
      (which is now sited on the shore itself), with cottages and boat
      sheds, a colour per theme, and a quarter name in every culture pack
      (custom packs fall back to English). Rail yards go where the line runs
      low, flat and by the river within reach of the station.
