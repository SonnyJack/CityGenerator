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

## Phase 1 — Terrain, tiles and rendering

- [ ] Base heightmap (fBm + domain warp + presets: plains, coast, bay, river
      valley, hills, archipelago, delta, estuary); imported heightmap.
- [ ] Hydrology: depression filling, flow, rivers with width, lakes, sea,
      bathymetry, tidal flats and marsh.
- [ ] Derived rasters: slope, aspect, distance to water, flood risk.
- [ ] Biome packs (first six: temperate maritime, temperate continental,
      mediterranean, boreal, desert, tropical monsoon) and land cover (R2):
      forest type, moor, marsh, savanna, paddy, mangrove, farmland suitability.
- [ ] Lazy terrain detail tiles with edge-consistent noise; contours; Terrain-RGB
      tiles for hillshade and 3D terrain.
- [ ] Tile builder (`geojson-vt` + `vt-pbf`) behind a MapLibre custom protocol
      served by the worker pool, with versioning and cancellation.
- [ ] Theme compiler (intermediate format → MapLibre style JSON); `atlas` theme.
- [ ] **Ink spike**: hatch sprites, cased/dashed lines, sketch jitter in the
      tile builder; reviewer decision on MapLibre vs. PixiJS fallback.
- [ ] Generate dock with Region/Terrain parameters; six-seed variations strip.

Acceptance: 60 km region terrain in < 3 s cold; any tile < 80 ms; no visible
seams at tile edges in a visual test; ink spike signed off or fallback chosen.

## Phase 2 — Settlements, districts and the classic town

- [ ] Settlement siting via the placement engine core (constraints, scorers,
      Poisson candidates); settlement kinds; pinning.
- [ ] Buildable mask, growth axes, historic core extent from `founded`.
- [ ] Relaxed-Voronoi districts clipped to terrain and split by rivers.
- [ ] Curtain wall, gates, citadel, plaza; gate-to-plaza arteries; organic
      streets; bridges.
- [ ] Zone profiles for the reference's ward set with `rateLocation`-style
      scoring.
- [ ] **Block boundary**: block polygons + recipes; lazy block generation
      (parcels, buildings, fill) keyed by block id; LRU cache; tiles assembled
      from blocks.
- [ ] Regional roads between settlements (terrain-routed); rural fill: farms,
      woods, hamlets, lanes.
- [ ] `ink` theme complete; district labels.

Acceptance: golden-seed hash tests for 10 seeds × 4 presets; a 40 km region
with a city and ten villages navigates from region to street at 60 fps; a
reviewer comparing the medieval town with the reference finds no loss of
believability.

## Phase 3 — Years, society fields and modern streets

- [ ] Era profiles for 1100, 1400, 1650, 1780, 1850, 1890, 1925, 1955, 1985,
      2020 with interpolation; `year` in the spec and the bottom bar.
- [ ] Wealth and density rasters (DESIGN §6.2), nuisance feedback, inequality;
      district classes; overlays with legends; hatch variants.
- [ ] Road hierarchy: arterials, ring roads, motorways with junctions after
      1950; bridges, cuttings, tunnels; contour-aligned local streets.
- [ ] Street patterns: grid (jitter, diagonals), radial, cul-de-sac, garden
      suburb; growth rings by era around the historic core (mixed eras).
- [ ] Zone profiles for every wealth × density combination, CBD, high street,
      warehouse district, tenement district, streetcar suburb, garden suburb,
      tower estate; building kinds per era.
- [ ] "Why is this here?" inspector showing zone and placement scores.

Acceptance: overlays show coherent gradients (rich uphill/upwind, poor by
industry) on 8 of 10 seeds without edits; changing the year from 1890 to 1925
to 1985 on one seed produces a recognisably continuous city.

## Phase 4 — Editor

- [ ] Selection: click, box, lasso, by-query; properties panel; multi-select.
- [ ] Draw: street/rail/tram/waterway/wall lines with class; zone, building,
      water, park, facility polygons; rectangle and freehand buildings; POIs.
- [ ] Edit: move, rotate, scale, mirror, vertex edit, split/join, offset,
      snapping (grid, network, parcel, angle), alignment guides.
- [ ] Brushes: terrain (raise/lower/smooth/flatten/water), zone, wealth,
      density, vegetation, year, erase, reroll.
- [ ] Authored vs. generated: freeze/unfreeze; regeneration around authored
      features with conflict rules and inspector reporting.
- [ ] Regenerate at region/settlement/district/area scope with pins kept.
- [ ] Annotations: labels, markers, arrows, GM notes, handout frames.
- [ ] Layers panel (show/hide/lock/opacity); undo/redo with history strip;
      autosave; recent documents; migrations tested against fixtures.

Acceptance: Playwright e2e for every tool; geometry validity checks pass after
each command in a fuzz test; a hand-drawn street and building survive a reseed
and a year change.

## Phase 5 — Rail and tram

- [ ] Rail graph with gradient and curve-radius constraints; regional mainlines
      and junctions; branch lines by population and year.
- [ ] Stations (central, suburban, halt), goods yards beside early stations;
      level crossings, bridges, viaducts, tunnels; elevated and subway variants
      for metropolises after 1900.
- [ ] Freight spurs and sidings to industrial districts and ports.
- [ ] **Rail yard** feature: ladder tracks, throats, roundhouse and turntable,
      coaling and water (steam era), diesel depot and intermodal cranes later.
- [ ] Tram/streetcar lines 1880–1960 with depots; streetcar suburbs around
      termini.
- [ ] Rail and tram rendering across zooms; rail noise into the wealth field.

Acceptance: no track exceeds the gradient cap on hill presets; yards connect at
both throats; a 1925 metropolis has a central station, goods yard, at least one
suburban line and a tram network; stats report track length and stations.

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
