# CityGenerator — Design Document

Status: **Draft v0.12** (Phases 3–10 delivered; see §16)
Audience: contributors, reviewers, and anyone deciding whether to build this.

CityGenerator is a browser-based procedural generator and editor for
metropolitan-scale maps aimed at tabletop role-playing games, with Call of
Cthulhu as the primary target. It is inspired by watabou's
[Medieval Fantasy City Generator (TownGeneratorOS)](https://github.com/watabou/TownGeneratorOS)
and extends it with metropolitan regions, modern infrastructure (rail, ports,
industry), explicit wealth and density modelling, a general feature-placement
and gap-filling system, topography, a full editor, and an LLM assistant that
can answer questions about a map and edit it.

Companion documents:

- [ROADMAP.md](./ROADMAP.md) — phased delivery plan with acceptance criteria.
- [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md) — decisions taken, questions still
  open, and suggested features.

---

## 1. Goals and non-goals

### 1.1 Goals

1. **Metropolitan regions.** A single document can hold a region of tens of
   kilometres containing a core city, satellite towns, villages, and the
   countryside between them, all generated coherently, and navigable from
   region overview down to individual buildings without loading pauses.
2. **Eras from medieval to modern**, chosen by **year** rather than by a fixed
   list, with mixed-era layouts (an old core inside a later grid) and
   particular care for the periods Call of Cthulhu uses: Gaslight (1890s),
   Classic (1920s–30s) and Modern.
3. **Modern infrastructure**: railways, train yards, ports (break-bulk and
   container), dry docks and shipyards, industrial zones and facilities, with
   realistic siting rules and era-appropriate variants.
4. **Wealth and density** as continuous fields that drive layout, building
   style and rendering, visible as overlays and editable with brushes.
5. **General placement engine** with declarative constraints for any feature
   (built or natural), plus ordered "fill" passes so no land is left
   unexplained.
6. **Topography**: multi-resolution heightmap with hydrology (rivers, lakes,
   coast, bathymetry), slope constraints, contours and hillshade, and
   terrain-aware road and rail routing with bridges, cuttings and tunnels.
7. **Full editor.** Everything the generator makes can be selected, moved,
   redrawn, deleted or frozen. Users can draw roads, rail, water, zones,
   buildings and points of interest by hand, and paint terrain, zones, wealth,
   density and vegetation with brushes. Hand-authored geometry survives
   regeneration.
8. **Deterministic and reproducible.** The document (`.citygen.json`) fully
   reproduces the map in another session. The document is not size-constrained;
   URL sharing is a convenience for small documents only.
9. **Static site on GitHub Pages**: no backend for generation, editing, or
   export.
10. **LLM assistant** (Anthropic, bring-your-own-key) that answers questions
    about the map and edits it through the same command API the editor uses.
11. **Industry-standard stack**: TypeScript, Vite, React, GeoJSON, vector tiles,
    MapLibre GL, Web Workers, GitHub Actions, the official Anthropic SDK.

### 1.2 Non-goals (initially)

- Real-world geodata import (OpenStreetMap, DEM tiles). Planned later; the data
  model is GeoJSON precisely so this stays possible.
- Multiplayer or collaborative editing.
- Economic or traffic simulation. A **growth timeline** (the region at year _t_)
  is planned, but as a generation parameter, not a simulation.
- Print tiling to paper. PNG handouts and SVG are in scope; tiled PDF is not
  needed yet.
- Pixel-perfect reproduction of watabou's output. We take the ideas, not the
  code; this is a **clean-room reimplementation** (§13).

### 1.3 Primary user stories

- _A Keeper preparing a 1920s campaign_ generates a New England-style coastal
  region: a decaying fishing port, a university town 20 km inland, farms and
  woods between them, a rail line joining them to the metropolis at the map
  edge. They zoom into the port, drag the cannery next to the wharves, paint the
  waterfront district poorer, add a boarding house and a warehouse by hand, and
  export a period-style handout of the harbour.
- _A worldbuilder_ paints a bay and a river, asks the assistant for "a
  container port on the deep side of the bay with a rail yard behind it and the
  wealthy suburbs on the opposite shore", then refines by hand.
- _A developer_ adds a new feature type ("gasworks", "asylum") as a JSON
  definition plus an optional TypeScript layout function, without touching the
  core pipeline.

---

## 2. Lessons from TownGeneratorOS

The reference project (Haxe/OpenFL, GPL-3.0) works roughly like this:

1. Generate points in a spiral around the origin, build a **Voronoi diagram**,
   Lloyd-relax the central cells a few times. Cells are called **patches**.
2. The innermost patch becomes the **plaza**; a compact outer patch becomes the
   **citadel**. Random flags decide whether a plaza, a citadel and **walls**
   exist. A `CurtainWall` is fitted around the inner patches, with gates.
3. A `Topology` graph over patch edges is used for pathfinding. Each gate is
   connected to the plaza (streets) and outward (roads). Streets are smoothed and
   tidied into continuous "arteries".
4. Unassigned patches receive **wards** from a weighted list (`CraftsmenWard`
   dominates). Ward classes expose `rateLocation()` to score a patch's
   suitability. Outer patches become `GateWard`, `Farm`, or plain `Ward`.
   Ward set: Administration, Castle, Cathedral, Common, Craftsmen, Farm, Gate,
   Market, Merchant, Military, Park, Patriciate, Slum.
5. Each ward subdivides its patch into building footprints with a recursive
   splitter tuned per ward (block size, regularity, gaps).

**What we keep:** patch/ward decomposition for organic settlements,
`rateLocation`-style scoring, gate-driven artery generation, recursive lot
subdivision, seeded determinism, and the clean ink aesthetic as one theme.

**What we change:**

| Limitation in the reference                 | Our approach                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| One town, one Voronoi partition, no terrain | Region → settlements → districts → blocks hierarchy on top of a terrain layer                              |
| Everything generated and drawn at once      | Settlement-level stages eager; block-level detail generated lazily per tile and cached                     |
| Wards are discrete, hand-picked classes     | Continuous wealth/density fields discretised per district; ward types become data-driven **zone profiles** |
| Only pre-modern features                    | Year-gated feature library: trams, rail, yards, docks, container ports, dry docks, industry, and more      |
| Placement implicit in ward selection        | Explicit **placement engine** with constraints, scoring, orientation, manual pins                          |
| Empty land outside wards                    | Multi-pass **fill** system at settlement and rural scale                                                   |
| Streets only from gates to plaza            | Road hierarchy, grid/organic/radial patterns; rail, tram and water as separate graphs                      |
| No editing after generation                 | Full editor; authored geometry is part of the document and survives regeneration                           |

---

## 3. System overview

```
┌──────────────────────────── Browser (GitHub Pages) ─────────────────────────────┐
│                                                                                 │
│  ┌────────────┐  commands   ┌──────────────────┐  document   ┌────────────────┐ │
│  │ Editor UI  │ ──────────▶ │ Command bus /    │ ──────────▶ │ Worker pool:   │ │
│  │ (React)    │             │ document store   │             │ generation     │ │
│  │            │ ◀────────── │ undo/redo,       │ ◀────────── │ pipeline +     │ │
│  └────────────┘  results    │ autosave (IDB)   │  tiles,     │ tile builder   │ │
│        ▲                    └──────────────────┘  summaries  └────────────────┘ │
│        │ vector tiles (custom protocol)     ▲                                   │
│  ┌─────┴──────┐                     ┌───────┴────────┐    HTTPS (BYOK)          │
│  │ MapLibre GL│                     │ LLM assistant  │ ─────────────▶ Claude    │
│  │ + themes   │                     │ (tool use)     │                API       │
│  └────────────┘                     └────────────────┘                          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Four ideas hold the design together:

1. **Document in, tiles out.** A `MapDocument` (generation spec + authored
   geometry + overrides + annotations) is the only input. The pipeline derives
   region- and settlement-level results eagerly, and block-level detail lazily
   per tile. Nothing derived is edited directly; edits become authored geometry
   or overrides in the document.
2. **Everything is a command.** Editor tools, brushes and LLM tool calls all
   dispatch typed commands that mutate the document. Undo/redo, autosave and
   LLM safety follow from that.
3. **Stages are pure, cached and hierarchical.** Each stage is keyed by a hash
   of its inputs and a named PRNG stream. Region stages feed settlement stages
   feed block stages. Moving a pinned port re-runs that settlement's placement
   and the affected tiles, not the terrain.
4. **The renderer is a map engine.** The generator produces vector tiles in a
   synthetic planar CRS; MapLibre GL renders them with JSON style themes. This
   gives level-of-detail, label collision, smooth zoom from 60 km to 6 m, and
   optional 3D extrusion without custom rendering code.

---

## 4. Technology choices

| Concern       | Choice                                                                                                                                 | Why                                                                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Language      | TypeScript (strict)                                                                                                                    | Runs in browser and Node (tests, CLI, MCP server)                                                                                                                              |
| Build / dev   | Vite                                                                                                                                   | Static output, first-class Web Worker support                                                                                                                                  |
| UI            | React 19 + Zustand + Tailwind CSS                                                                                                      | Decided; Zustand keeps state serialisable                                                                                                                                      |
| Forms         | JSON Schema (from Zod) for the spec + generated forms                                                                                  | One schema drives validation, the UI, migrations and LLM tool schemas                                                                                                          |
| Map rendering | **MapLibre GL JS** with an in-browser custom tile protocol                                                                             | Industry-standard vector map engine: LOD, label collision, style JSON, hillshade, `fill-extrusion` 3D, high-DPI export; designed for exactly the "region to street" zoom range |
| Vector tiles  | `geojson-vt` + `vt-pbf` inside the worker                                                                                              | Standard MVT tiles from our GeoJSON, no server                                                                                                                                 |
| Geometry      | `d3-delaunay` (Voronoi), `polygon-clipping`, `flatbush` (spatial index), `simplify-js`, `poisson-disk-sampling`, `@turf/*` selectively | Mature, deterministic                                                                                                                                                          |
| Terrain       | `simplex-noise`, `d3-contour`; hillshade via MapLibre `raster-dem` from generated Terrain-RGB tiles                                    | Standard noise and contour extraction; free hillshade/3D terrain                                                                                                               |
| Data model    | GeoJSON `FeatureCollection` in local planar metres, typed `properties`                                                                 | Interoperable (QGIS, turf), trivially serialisable                                                                                                                             |
| Randomness    | Own seeded PRNG (sfc32, seeded from a 128-bit hash of a stream path) with named sub-streams and per-tile derivation                    | Determinism across browsers; `Math.random` is banned in `core`                                                                                                                 |
| Concurrency   | Worker pool via `comlink`; tile requests cancellable                                                                                   | Keeps the UI at 60 fps; parallel tile builds                                                                                                                                   |
| Persistence   | `.citygen.json` import/export; IndexedDB autosave and recent documents; optional URL hash for small documents                          | No backend; the document is the source of truth                                                                                                                                |
| LLM           | `@anthropic-ai/sdk` in the browser, bring-your-own-key                                                                                 | Decided: Anthropic only to start                                                                                                                                               |
| Testing       | Vitest (unit, golden-seed hashes), Playwright (e2e, visual regression on Chromium/Firefox/WebKit)                                      | Standard                                                                                                                                                                       |
| CI/CD         | GitHub Actions → GitHub Pages                                                                                                          | Required                                                                                                                                                                       |
| Repo          | pnpm workspaces monorepo                                                                                                               | Engine reusable outside the app                                                                                                                                                |
| Licence       | Clean-room, MIT, copyright "CityGenerator contributors"                                                                                | Decided                                                                                                                                                                        |

### 4.1 Why MapLibre and not a custom Canvas renderer

A 40 km region at 1920s density contains on the order of a million building
footprints. Drawing that with Canvas 2D means writing tiling, culling, LOD,
label placement and style zoom-interpolation ourselves. MapLibre already does
all of it on WebGL and is what real-world map products use. The costs are:

- The **ink theme** must be expressed as a MapLibre style: hatched fills from
  a sprite, dashed and cased lines, and a "sketch" geometry post-process
  (controlled jitter applied when the ink theme's tiles are built). It will be
  close to the reference's look, not identical. Phase 1 includes a spike to
  prove this is good enough; the fallback is a PixiJS renderer behind the same
  tile source.
- **SVG export** cannot come from MapLibre. A separate `svg-export` package
  walks the model for a chosen bounding box and applies the same theme
  definitions (themes are authored in a small intermediate format compiled to
  both MapLibre style JSON and SVG styles).
- Coordinates must be lon/lat internally for MapLibre. We use a **synthetic
  CRS**: the region origin is placed at longitude 0, latitude 0 and metres are
  converted with a fixed factor (1° ≈ 111.32 km). Mercator distortion below
  0.5° of latitude is under 0.005 %, so a 60 km region is effectively planar.
  The model stays in metres; the conversion happens in the tile builder.

### 4.2 Repository layout

```
CityGenerator/
├── apps/
│   └── web/                 # Vite + React editor deployed to GitHub Pages
├── packages/
│   ├── core/                # document schema, PRNG, stage runner, geometry, pipeline (no DOM)
│   ├── features/            # feature library: zone profiles, feature types, layouts (JSON + TS)
│   ├── tiles/               # tile builder: model → MVT + Terrain-RGB, sketch post-process
│   ├── themes/              # theme sources compiled to MapLibre style JSON and SVG styles
│   ├── editor/              # command bus, tools, selection, snapping, history (framework-agnostic)
│   ├── llm/                 # Anthropic adapter, tool definitions, prompts, evals
│   ├── export/              # PNG, SVG, GeoJSON, Universal VTT, Foundry
│   └── mcp/                 # (later) MCP server and CLI over the same commands
├── docs/                    # design, roadmap, ADRs, feature-authoring guide
└── .github/workflows/       # ci.yml, pages.yml
```

---

## 5. Data model

### 5.1 `MapDocument` (the `.citygen.json` file)

The document is the unit of persistence and is not size-constrained. It has
four parts:

```ts
interface MapDocument {
  format: 'citygen';
  version: 2; // migrations are part of core
  meta: { name: string; created: string; modified: string; app: string; notes?: string };

  spec: RegionSpec; // generation parameters (small)
  authored: FeatureCollection<AuthoredProps>; // hand-drawn geometry (can be large)
  overrides: Override[]; // targeted patches to generated results, e.g. pins, frozen features
  annotations: Annotation[]; // GM notes, labels, markers, handout regions
  viewport?: { center: [number, number]; zoom: number; bearing: number; pitch: number };
  ui?: { theme: string; layers: LayerState; year?: number }; // presentation only
}
```

- `spec` is what the generator reads. `authored` and `overrides` are inputs
  too: the generator treats authored geometry as fixed and generates around it.
- Derived results are **never** stored in the document; they are recomputed
  (and cached in IndexedDB keyed by hash for fast reopen).
- Every feature in `authored` carries `layer` (`street`, `rail`, `tram`,
  `water`, `zone`, `building`, `facility`, `poi`, `vegetation`, `terrainEdit`,
  `fieldEdit`) and `origin: 'authored' | 'frozen'` (frozen = generated then
  fixed by the user, keeps its original id for provenance).

### 5.2 `RegionSpec`

```ts
interface RegionSpec {
  seed: string;
  extent: { widthM: number; heightM: number }; // up to ~60 km on a side
  year: number; // 1100..2050; drives era profile
  biome: BiomeId; // climate/vegetation pack, e.g. 'temperateMaritime', 'tropicalMonsoon'
  culture: CultureId; // naming/building-style pack, e.g. 'newEngland', 'japan', 'maghreb'
  cultureMix?: { culture: CultureId; weight: number; districts?: string[] }[]; // colonial/immigrant quarters

  terrain: {
    preset:
      'plains' | 'coast' | 'bay' | 'riverValley' | 'hills' | 'archipelago' | 'delta' | 'estuary' | 'custom';
    relief: number;
    roughness: number;
    seaLevel: number;
    rivers: { major: number; minor: number };
    importedHeightmap?: { dataUrl: string; minM: number; maxM: number; cellSizeM: number };
  };

  settlements: SettlementSpec[]; // explicit list; empty = let the generator place them
  settlementPolicy: { count: [number, number]; kinds: Record<SettlementKind, number> }; // weights
  society: { wealth: FieldParams; density: FieldParams; inequality: number };
  networks: RegionNetworkSpec; // inter-settlement roads, rail, ferries, canals
  features: FeatureRequest[]; // region-level requests (e.g. "one naval base", "quarry")
  overridesPolicy: { keepFrozenOnReseed: boolean };
}

interface SettlementSpec {
  id: string;
  name?: string;
  kind:
    | 'metropolis'
    | 'city'
    | 'town'
    | 'village'
    | 'hamlet'
    | 'portTown'
    | 'fishingVillage'
    | 'millTown'
    | 'miningTown'
    | 'resort'
    | 'universityTown'
    | 'suburb'
    | 'industrialSatellite';
  site?: { center: [number, number]; lock: boolean }; // pin or let the placement engine choose
  population: number;
  founded?: number; // year; older core = organic + walls
  growth?: { year: number; population: number }[]; // optional timeline
  layout: { streetPattern: 'organic' | 'grid' | 'radial' | 'mixed'; blockSizeM?: number; walls?: boolean };
  features: FeatureRequest[]; // settlement-level requests (port, yard, campus…)
  overrides?: Partial<SocietyParams>;
}
```

`year` selects an **era profile** (a data file) that gates feature types, street
widths, building kinds, vehicle-era assumptions (horse, tram, car) and the
default mix of zone profiles. Profiles exist for 1100, 1400, 1650, 1780, 1850,
1890, 1925, 1955, 1985, 2020; intermediate years interpolate weights and pick
the nearest profile for discrete choices.

### 5.3 Derived model

The derived model is hierarchical and partially materialised:

```
RegionModel
 ├─ terrain (base raster ~60 m/cell + lazily refined 4 m/cell detail tiles)
 ├─ fields: wealth, density, landValue (region raster)
 ├─ hydrology: rivers, lakes, coast, bathymetry
 ├─ settlements[]: site, footprint, SettlementModel (eager)
 ├─ networks: regional road/rail/water graphs
 └─ rural: land cover polygons, farms, woods, estates (eager, coarse)

SettlementModel (eager, per settlement)
 ├─ districts[] with zone profile, wealth/density class, era
 ├─ networks: streets, tram, rail, water (settlement scale)
 ├─ facilities[] (placed features with parts)
 ├─ blocks[] : polygon + block seed + generation recipe   ← boundary between eager and lazy
 └─ stats

BlockModel (lazy, cached, keyed by block id + inputs hash)
 ├─ parcels[] ├─ buildings[] ├─ fill[] (parking, gardens, trees…) └─ pois[]
```

All geometry is GeoJSON with typed `properties`. The **block** is the unit of
lazy generation because parcels and buildings depend only on the block polygon,
its recipe (zone profile, wealth/density class, era, frontage streets) and the
block seed. Tiles are assembled from the blocks that intersect them; blocks
crossing tile boundaries are generated once and shared.

### 5.4 Coordinate system

Model coordinates are planar metres with origin at the region centre, x east,
y north. The tile builder converts to the synthetic lon/lat for MapLibre
(§4.1). Exports to GeoJSON stay in metres and declare the synthetic CRS in
metadata.

---

## 6. Generation pipeline

Stages are pure functions `(inputs, rng) → outputs`, memoised on a content hash
of their inputs, each with its own named PRNG stream. The pipeline runs in a
worker pool; region and settlement stages run eagerly on document change, block
stages on demand.

```
Region level (eager)
  R1 Terrain base       heightmap → hydrology → coast/rivers/lakes → slope/bathymetry
  R2 Land cover         climate + terrain → forest, marsh, moor, farmland suitability
  R3 Settlement siting  place settlements (placement engine): harbours, crossings, confluences…
  R4 Society fields     wealth, density, land value across the region
  R5 Regional networks  roads/turnpikes, rail mainlines + junctions, ferries, canals between settlements
  R6 Rural fill         estates, farms, hamlets, woods, quarries, mills along rivers, country lanes

Settlement level (eager, per settlement, parallel)
  S1 Site               buildable mask, growth axes, historic core extent per `founded`/`year`
  S2 Districts          partition + zone profile + wealth/density/era class
  S3 Macro network      arterials, ring roads, tram lines, rail approach + stations
  S4 Placement          facilities (ports, yards, plants, campuses, parks…) with connectors
  S5 Local network      streets per district pattern; spurs, sidings, quays
  S6 Blocks             block polygons + recipes (the eager/lazy boundary)
  S7 Amenities & POIs   what each district is "owed": churches, schools, pubs, police, hospital…
  S8 Naming & stats

Block level (lazy, per tile request)
  B1 Parcels            lot subdivision by recipe
  B2 Buildings          footprints, kind, floors, roof, use, address
  B3 Fill               gardens, yards, parking, trees, sheds, walls
  B4 Sketch (ink theme) controlled jitter for hand-drawn look

Terrain detail (lazy, per tile)
  T1 Refine             upsample base heightmap + detail noise, re-cut rivers, contours, Terrain-RGB
```

Authored geometry enters at every level: authored terrain and field edits
before R1/R4, authored regional networks before R5, authored districts/zones
before S2, authored streets/rail before S5, authored buildings before B2. The
generator treats authored features as fixed constraints and fills around them.

### 6.1 Terrain (Goal 6)

- **Multi-resolution.** The base raster covers the region at ~60 m/cell
  (1000² cells for 60 km, ~4 MB per Float32 layer). Detail tiles at 4 m/cell
  are produced on demand by bicubic upsampling plus band-limited detail noise
  seeded per tile, so any two tiles agree at their shared edge. Hydrology runs on
  the base raster; river centrelines are refined at the detail level.
- **Generation**: fBm with domain warping blended with preset shape functions
  (coast gradient, valley profile, bay/estuary mask, archipelago falloff) and
  the biome pack's relief and coast-type parameters (fjord, reef, lagoon…).
  Imported heightmaps replace the noise. User brush edits (raise, lower,
  smooth, flatten, water) are authored features replayed after generation.
- **Hydrology**: priority-flood depression filling, D8 flow, accumulation,
  rivers above a threshold with width from accumulation, lakes from filled
  depressions, sea below sea level, **bathymetry** from a smoothed extension of
  the land slope below the coast (needed for harbours and ports), tidal flats
  and marsh where slope is near zero at the coast.
- **Derived**: slope, aspect, distance to water/sea, viewshed proxy (elevation
  above local mean), flood risk (low and near water).
- **Contours** (marching squares) at theme-chosen intervals; **hillshade** and
  optional 3D terrain from Terrain-RGB tiles rendered by MapLibre.
- **Routing**: regional roads and rail use A* on the base raster with cost =
  distance × (1 + k·slope) and hard gradient caps (rail ≈ 2.5 %, motorway 6 %,
  local streets 12 %). Crossings of water or over-cap segments become bridges,
  cuttings, embankments, viaducts or tunnels, stored on the edge and rendered
  distinctly. Local streets on slopes follow contours (terraces).

### 6.2 Society fields: wealth and density (Goal 4)

Two scalar rasters in `[0, 1]` at region resolution, refined per settlement,
plus derived land value.

```
density(p) = σ( a·centreProximity(p) + b·transitAccess(p) + c·flatness(p) + noise )
wealth(p)  = σ( d·elevationAdvantage(p) + e·waterfrontAmenity(p) + f·distanceFromNuisance(p)
              − g·industrialProximity(p) − h·railNoise(p) − i·floodRisk(p)
              + j·paintedOverrides(p) + noise )
```

- `centreProximity` is per settlement and per growth axis; the metropolis
  dominates the regional field, satellites add local peaks.
- Nuisance sources (industry, yards, ports, gasworks, power plants, tanneries in
  early eras) and prevailing wind produce the classic "poor east end, rich west
  end" pattern automatically. Because nuisance depends on placement, fields are
  computed coarse before placement and refined after.
- `inequality` scales the spread; `year` shifts baselines (1925: dense
  tenements near work, streetcar suburbs for the middle class, estates for the
  rich).
- **Discretisation** per district: `wealthClass ∈ {slum, poor, modest,
comfortable, affluent, elite}`, `densityClass ∈ {rural, suburban, low,
medium, high, core}`. Both numeric and class values are exposed to the UI and
  the assistant.
- **Effects** via zone profiles: lot size, footprint, floors, setback, street
  width and pattern, tree density, park probability, road surface, amenity
  quality.
- **Editing**: wealth and density brushes write authored `fieldEdit` features;
  the inspector shows the numeric value and class for any point.
- **Rendering**: choropleth overlays with legends in colour themes; hatch
  patterns in ink/print themes; GM-only by default in player exports.

### 6.3 Settlements and districts

- **Settlement siting** uses the placement engine (§6.5) with feature types
  per settlement kind: a `portTown` wants a sheltered deep harbour; a
  `millTown` wants a river with gradient; a `universityTown` wants a mid-size
  site away from heavy industry; a `suburb` wants to be 5–15 km from the
  metropolis on a rail line or arterial. Users can pin sites.
- Each settlement gets a **historic core** whose extent is derived from
  `founded` and the growth curve: an organic Voronoi-patch core (with walls if
  the founding era had them and the era profile keeps remnants), surrounded by
  rings whose street pattern follows the era they were built in. This is how
  mixed-era layouts arise naturally rather than by a "mixed" switch.
- **Districts** are relaxed-Voronoi patches (organic rings) or super-block
  unions (grid rings), clipped to the buildable mask and split by rivers, rail
  and arterials.
- **Zone profiles** are data (JSON), scored per district by fields and
  adjacency. Built-in profiles cover the reference's wards and modern ones:
  CBD/downtown, residential at every wealth × density combination, retail
  strip/high street, warehouse district, light and heavy industry, logistics,
  port, rail lands, institutional, campus, hospital, military, cemetery, park,
  allotments, and era-specific ones (streetcar suburb, tenement district,
  company town rows, garden suburb, tower estate).

### 6.4 Networks

Graph types: **street** (motorway → arterial → collector → local → lane/alley),
**tram/streetcar** (on streets, 1880–1960 by default), **rail** (mainline,
branch, spur, siding, yard; elevated and subway variants for metropolises after
1900), **water** (shipping lanes, ferries, canals with locks).

- Regional roads connect settlements by terrain-routed paths; after ~1950 a
  motorway network with junctions and a ring road appears for the metropolis.
- **Rail**: mainlines enter from 1–3 map edges, junction at the metropolis,
  branch lines to towns proportional to population and year; central stations at
  closest approach with goods yards beside them in earlier eras; suburban
  stations spaced by era; freight spurs to industry and ports; level crossings
  on local streets, bridges on arterials; minimum curve radius and gradient
  cap enforced; sleepers rendered at high zoom.
- **Tram** lines radiate from the centre along arterials in the years they
  existed, and generate the streetcar suburbs around their termini.
- Implementation (Phase 5): `railStage` runs after siting and before the
  society stage (its corridors and yards are nuisance sources); it routes on
  the terrain raster with a class-specific gradient cap in the cost, eases
  curves to a minimum radius, fits a vertical profile within the cap and
  splits each line into surface/cutting/embankment/viaduct/tunnel runs.
  `tramStage` runs per settlement after the town stage on the town's street
  graph and also computes the crossings between the railway and the streets;
  crossings with regional roads are computed when the tile layers are built.
  Both are memoised like every other stage.
- **Water**: shipping approach along deepest bathymetry; ferries where a
  crossing lacks a bridge; canals (1760–1900) as straight cuts with locks where
  terrain requires, with wharves and warehouses along them.

### 6.5 Placement engine (Goal 5)

A single engine places everything from a settlement to a park bench. A
**feature type** declares:

```ts
interface FeatureType {
  id: string; // 'port.container', 'rail.yard', 'settlement.millTown'
  level: 'region' | 'settlement' | 'block';
  years: [number, number]; // availability window
  footprint: FixedFootprint | ParametricFootprint;
  hard: Constraint[]; // all must pass
  soft: Scorer[]; // weighted sum
  orientation: 'free' | 'alignCoast' | 'alignRail' | 'alignStreet' | 'alignWind';
  connectors: ConnectorRequest[]; // { network: 'rail', class: 'spur' }, { network: 'street', class: 'arterial' }
  nuisance?: { radiusM: number; strength: number };
  layout: (ctx, footprint, rng) => SubFeature[]; // internal detail
  fill?: FillRule[];
  scaleCompression?: number; // shrink real-world sizes for playability (default per type)
}
```

Primitives: `nearWater(depthM, maxDistM)`, `sheltered()`, `maxSlope(x)`,
`inZone([...])`, `nearNetwork(kind, maxDistM)`, `awayFrom(profile, minDistM)`,
`downwindOf(centre)`, `flatArea(minM2)`, `onMapEdge(side)`,
`landValueBelow(x)`, `riverGradientAbove(x)`, `populationAtLeast(n)`.

Algorithm per request (pinned first, then by footprint size):

1. Pinned: validate hard constraints, warn on failure, carve, done.
2. Poisson-disk candidates over the passing mask; try allowed orientations.
3. Score = Σ wᵢ·scorerᵢ − overlap penalty − distance-from-hint (a vague hint
   such as "north of the station" is resolved to a point by the app).
4. Take the best; run `layout()`; emit connector requests; carve; register
   nuisance.
5. On failure: shrink, relax soft constraints, and finally report
   "could not place X because Y" to the UI and the assistant.

Implementation (Phase 6): `placeFeatures` in `core/placement` with the
built-in library in `library.ts`, defaults in `defaults.ts` and document
custom types in `custom.ts`; the `facilitiesStage` wraps it and routes the
connectors. Candidate centres come from the shore (rays from the town centre
to the sea, pulled inland by half the width), from river banks, from a
sunflower annulus around the town, or from a grid over the region; the
`alignCoast` and `alignRiver` orientations try both normals so the front edge
faces the water. Hard constraints and scorers are small functions over a
raster-backed context (`isLand`, `slopeAt`, `distToSea`, `seaFraction`,
`distToRail`, tangents), so a custom type composes the same primitives.

### 6.6 Modern and period facilities (Goal 3)

Each is a `FeatureType` with a bespoke `layout()` and era variants:

| Feature                                       | Siting                                                                                | Layout by era                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Port**                                      | Deep sheltered water, straight shoreline, flat, low land value, wants rail + arterial | _≤1900_: finger piers, wharves, bonded warehouses, customs house, ship chandlers, sail lofts. _1900–1960_: break-bulk quays, transit sheds, rail on the quay, cranes, grain elevator, cold store, coal staithes. _≥1965_: container terminal: reclaimed quay, berths every 300 m, gantry cranes, container yard grid, gate complex, Ro-Ro ramp, tank terminal, breakwater, intermodal rail |
| **Fishing harbour**                           | Sheltered shallow water                                                               | Quay, fish market, ice house, net lofts, cannery/smokehouse, boat yard, slipway                                                                                                                                                                                                                                                                                                            |
| **Shipyard / dry dock**                       | Adjacent to harbour, deep water                                                       | Graving dock cut into the quay with caisson gate and pump house, slipways, building berths, mould loft, plate shops; floating dock variant; modern variant with covered halls                                                                                                                                                                                                              |
| **Rail yard**                                 | Beside a mainline, flat, long, near industry/port; avoids affluent                    | Ladder tracks from a throat at each end, 6–30 roads, hump (optional), engine shed / roundhouse and turntable (steam era), coaling stage, water tower; diesel depot and intermodal cranes later                                                                                                                                                                                             |
| **Heavy industry**                            | Flat, near rail/water, downwind, low wealth                                           | Halls, tank farms, chimneys/stacks, cooling towers, pipe racks, sidings, slag heaps (steel), coke ovens                                                                                                                                                                                                                                                                                    |
| **Gasworks** (1810–1970)                      | Edge of town near rail/canal                                                          | Retort house, gasholders (circles), coal yard, tar tanks                                                                                                                                                                                                                                                                                                                                   |
| **Mill** (water 1100–1900, textile 1780–1950) | River with gradient / canal                                                           | Mill race, wheel house, multi-storey mill, workers' rows, mill pond                                                                                                                                                                                                                                                                                                                        |
| **Light industry / logistics**                | Near motorway junction, flat                                                          | Big-box warehouses, docks, truck yards                                                                                                                                                                                                                                                                                                                                                     |
| **Power plant**                               | Cooling water, fuel by rail/water                                                     | Turbine hall, boilers, stacks/cooling towers, switchyard, lines leaving                                                                                                                                                                                                                                                                                                                    |
| **Refinery / chemical**                       | Port + rail, far from residential                                                     | Dense tank farm, process units, flare stack                                                                                                                                                                                                                                                                                                                                                |
| **Airport** (≥1925)                           | Very flat, very large, outer edge                                                     | Grass field and hangars early; runways aligned to wind, terminal, apron later                                                                                                                                                                                                                                                                                                              |
| **Institutions**                              | Per type                                                                              | University campus (quad, library, laboratories), hospital, asylum/sanatorium (isolated, grounds, wings), prison, military base, cemetery, waterworks, observatory                                                                                                                                                                                                                          |

Sub-features are stored as `facilities[].parts[]` with their own geometry so
renderers draw cranes, tracks and tanks distinctly and exporters keep them.
Large facilities apply a `scaleCompression` factor by default (decided) so
that a port does not consume the entire town; a per-document "true scale"
toggle disables it, and the inspector shows both the compressed and real
dimensions.

### 6.7 Parcels, buildings and fill

- **Parcels**: blocks are subdivided with recursive OBB splitting parameterised
  by the zone profile (target lot area, regularity, frontage). Deep blocks get
  back lanes, mews or courtyards by era and wealth.
- **Buildings**: per parcel, a kind from the profile and class (row house,
  terrace, detached, villa, tenement, triple-decker, apartment block, tower,
  hall, shed, big box, courtyard block, shopfront with flats above…), with
  setbacks, `floors`, `roof`, `use`, `material` (for a Sanborn-style theme), and
  an **address** on its frontage street. Density controls coverage and floors;
  wealth controls setback, garden and irregularity; era controls kinds.
- **Fill passes** at block, then settlement, then region level:
  1. Amenities the district is owed (church/chapel, school, pub/tavern, corner
     shop, police box, fire station, post office, bank, cinema by era).
  2. Parks and greens in leftovers above a size threshold.
  3. Parking lots and yards in industrial/retail zones; allotments and
     cemeteries on the fringe.
  4. Rural: fields with hedgerows or fences by culture pack, farmsteads,
     orchards, woods on steep or wet land, moor/marsh, quarries, estates with
     parkland, mills along rivers, hamlets at crossroads.
  5. Point features: street trees by wealth, park trees, gardens.
  6. Leftovers smaller than a threshold merge into a neighbour; larger ones are
     "wasteland" and reported in stats.

Fill features are ordinary feature types that accept any leftover polygon.

### 6.8 Determinism and performance

- Same document ⇒ identical results on every browser. Own PRNG, stable sorts
  with explicit tie-breakers, no reliance on `Map`/`Set` iteration of hashed
  keys, pinned geometry library versions, tile-derived seeds
  (`hash(regionSeed, level, blockId)`).
- Budgets (mid-range laptop): region + settlement stages for a 40 km region
  with a 500k-population metropolis and ten towns < 6 s cold, < 1.5 s for an
  incremental edit within one settlement; any tile < 80 ms; first paint after
  opening a cached document < 1 s; 60 fps pan/zoom at all levels.
- Cancellation: a new document version cancels in-flight stage and tile work.
- Memory: block cache is LRU-bounded (~300 MB); tiles are rebuilt from blocks.

---

## 7. Feature library, era profiles, biomes and culture packs

- `packages/features` holds zone profiles, feature types, era profiles, biome
  packs and culture packs as JSON with optional TypeScript scorers and layouts,
  registered by id and validated by schema.
- **Biome and culture are independent axes** (decided: the generator must
  cover regions around the world). A biome decides what the land does; a
  culture decides what people build on it. Any combination is valid, and a
  region may mix cultures by district (`cultureMix`) for colonial ports,
  immigrant quarters or frontier towns.
- **Biome packs** define climate-driven land cover (forest type, moor, marsh,
  savanna, desert, paddy, mangrove, tundra), vegetation density and species
  symbols, river regime (perennial, seasonal wadi, braided), coast types
  (fjord, reef, lagoon, mangrove, cliff), agricultural patterns (open field,
  hedged, terraced, irrigated, oasis, plantation), snow line and typical
  relief, and hazards (flood, dune). Initial biomes: `temperateMaritime`,
  `temperateContinental`, `mediterranean`, `boreal`, `subarctic`, `steppe`,
  `desert`, `semiArid`, `subtropicalHumid`, `tropicalMonsoon`,
  `tropicalRainforest`, `savanna`, `alpine`.
- **Culture packs** define naming (street, district, water, business, given
  and family names, with grammar and transliteration options), street and
  block conventions (organic medina vs. Roman grid vs. Spanish plaza-mayor grid
  vs. Edo castle-town vs. Anglo-American grid; alleys, hutongs, mews), lot
  and building conventions (courtyard houses, row houses, shophouses,
  machiya, chawls, tenements, bungalows), roof and material mixes, religious
  and civic building kinds (church, chapel, mosque, temple, shrine, synagogue,
  gurdwara; market hall, bazaar, bathhouse, caravanserai), walls and
  fortification styles, cemetery conventions, and colonial-era overlays where
  a second culture arrived with a given year. Initial culture packs, chosen to
  span the world and to cover common Call of Cthulhu settings: `newEngland`,
  `americanMidwest`, `americanSouth`, `england`, `scotland`, `ireland`,
  `france`, `germanyCentralEurope`, `iberia`, `italy`, `scandinavia`,
  `russiaEasternEurope`, `balkansOttoman`, `maghreb`, `egyptLevant`,
  `arabianGulf`, `westAfrica`, `eastAfricaSwahili`, `southernAfrica`,
  `indiaSouthAsia`, `china`, `japan`, `korea`, `southeastAsia`, `australiaNz`,
  `mexicoCentralAmerica`, `andes`, `brazil`, `caribbean`. Packs are data, so
  breadth comes from contributions; each pack ships with a small reference
  gallery so reviewers can judge fidelity.
- Era profiles are culture-aware: the year a tram, a railway or a container
  port becomes available is looked up per culture pack with a global default,
  so an 1890 Shanghai and an 1890 Boston differ in more than names.
- Users can add custom feature types in the document (constraint/scorer
  primitives only, no code); these travel with the `.citygen.json`.
- Natural features (wood, marsh, quarry, cliff, sea cave) use the same shape as
  built ones.

---

## 8. Rendering

### 8.1 Tiles

The tile builder (in workers) produces two tile sets from the model:

- **Vector tiles (MVT)** with layers `landcover`, `water`, `contours`,
  `districts` (with wealth/density/zone attributes), `parcels`, `buildings`
  (with floors, use, material, era), `facilities`, `streets`, `tram`, `rail`,
  `waterways`, `walls`, `vegetation`, `pois`, `labels`, `annotations`. Which
  layers and how much detail appear at a given zoom is decided by the builder
  (`z ≤ 10`: region layers; `11–13`: settlement layers; `14–15`: blocks and
  streets; `≥ 16`: parcels, buildings, trees).
- **Terrain-RGB raster tiles** for MapLibre hillshade and 3D terrain.

Tiles are served through MapLibre's `addProtocol` from the worker pool; a
document change bumps the source version so only affected tiles are rebuilt.

### 8.2 Themes

Themes are authored in a compact intermediate format (feature class ×
wealth/density/era class → paint) and compiled to MapLibre style JSON and to
SVG styles. Initial themes:

- `ink` — reference-like black and white, hatched fills, sketch jitter.
- `atlas` — modern coloured map, OSM-like clarity, wealth/density overlays.
- `period-1920s` — street-atlas look of the era (fits Call of Cthulhu handouts).
- `sanborn` — fire-insurance-map style: buildings coloured by material and use,
  with names; excellent for investigative play.
- `blueprint`, `dark`, `print` (hatch-only, high contrast).

### 8.3 3D and pitch

Because buildings carry `floors`, MapLibre `fill-extrusion` gives an optional
3D view with terrain for free (a style toggle, not a separate renderer).

### 8.4 Export

- **PNG** at chosen scale and DPI for any rectangle, using an offscreen
  MapLibre instance with `preserveDrawingBuffer`; presets for handouts and VTT
  scenes (Foundry, Roll20 dimensions).
- **SVG** for any rectangle via `svg-export` walking the model with the theme.
- **GeoJSON** of the region or a rectangle (metres, synthetic CRS declared).
- **Universal VTT** (`.dd2vtt`) with wall lines from building outlines
  (decided, with a performance guard: walls are derived only for the export
  frame, from simplified outlines, merged along shared edges, and capped at a
  configurable segment count with a warning and a "buildings as solid blocks"
  fallback when the frame is too large for a VTT to handle), and **Foundry
  scene JSON** carrying the same walls.
- **Player export**: hides GM-only layers (overlays, notes, secret POIs).
- **`.citygen.json`** (the document) and, for small documents, a URL hash.

---

## 9. The editor

### 9.1 Layout

Map view centre with a floating tool strip and contextual options (tools), left dock (Generate: parameters
from the spec schema, grouped Region / Settlements / Terrain / Society /
Networks / Features / Year), right dock (Layers & legend, Inspector,
Assistant), bottom bar (coordinates, scale, year slider, undo history strip).

### 9.2 Tools

| Group    | Tools                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Navigate | pan, zoom, rotate, pitch, minimap, bookmarks                                                                                                                                                                 |
| Select   | click, box, lasso, by-query (all warehouses in this district), multi-select, properties panel                                                                                                                |
| Draw     | line (street with class, rail, tram, waterway/canal, wall), polygon (zone with profile, building, water body, park, facility footprint), rectangle building, freehand building, point (POI with type)        |
| Edit     | move, rotate, scale, mirror, vertex edit, split/join lines, offset, snap to grid/network/parcel/angle, alignment guides                                                                                      |
| Brushes  | terrain raise/lower/smooth/flatten/water; zone paint; wealth paint; density paint; vegetation paint; year paint (override era locally); erase; **reroll** (regenerate only the brushed area with a new seed) |
| Generate | regenerate region/settlement/district/selection; place feature (from library, with hint); freeze/unfreeze selection                                                                                          |
| Annotate | text label, marker, arrow, GM note (hidden in player export), handout frame (a named export rectangle)                                                                                                       |
| Layers   | show/hide/lock, opacity, reorder overlays                                                                                                                                                                    |

### 9.3 Authored vs. generated

- Anything the user draws is **authored** and stored in the document.
- Anything generated can be **frozen**: it is copied into `authored` with
  `origin: 'frozen'` and thereafter treated as fixed. Unfreezing removes it.
- Regeneration (new seed, new year, new parameters) keeps all authored and
  frozen features and generates around them. Conflicts are resolved in favour
  of the user (a generated street is cut where it would cross an authored
  building) and reported in the inspector.
- Brush strokes are authored features too (`terrainEdit`, `fieldEdit`), so they
  are undoable, visible in the layer list, and replayed on regeneration.
- Implementation (Phase 4): authored features live in a main-thread GeoJSON
  source styled by the theme compiler, so drawing never waits for the engine;
  the engine key that triggers regeneration ignores decorative layers (POIs,
  names, annotations). Terrain strokes feed the terrain stage before
  hydrology, field strokes the society stage, zone strokes and polygons the
  town stage; the block tiler drops generated buildings under authored
  buildings, zones, streets and rails, hides `suppress` targets and salts
  blocks inside `reroll` polygons. `reseed` overrides salt the seed of the
  siting, society, town and road stages (region) or one town.

### 9.4 History and persistence

- Undo/redo over commands; a history menu that jumps to any earlier state
  (thumbnails deferred).
- Autosave to IndexedDB on every command (debounced); a "Recent documents"
  screen; explicit `.citygen.json` export/import; schema migrations in `core`.
- Derived caches in IndexedDB keyed by hash for near-instant reopen.

---

## 10. Command API

All mutations, from the UI and the assistant, go through one bus:

```ts
type Command =
  | { type: 'spec.patch'; ops: JsonPatchOp[] }                       // RFC 6902 on RegionSpec
  | { type: 'settlement.add' | 'settlement.update' | 'settlement.remove'; ... }
  | { type: 'authored.add'; features: Feature<AuthoredProps>[] }
  | { type: 'authored.update'; id: string; geometry?: Geometry; properties?: Partial<AuthoredProps> }
  | { type: 'authored.remove'; ids: string[] }
  | { type: 'feature.place'; request: FeatureRequest; hint?: Hint }
  | { type: 'feature.move'; id: string; pose: Pose; lock?: boolean }
  | { type: 'freeze' | 'unfreeze'; ids: string[] }
  | { type: 'brush'; brush: BrushKind; stroke: Stroke; value: number }
  | { type: 'regenerate'; scope: { level: 'region' | 'settlement' | 'district' | 'area'; id?: string; polygon?: Polygon }; newSeed?: boolean }
  | { type: 'year.set'; year: number }
  | { type: 'annotate.*'; ... }
  | { type: 'style.set'; patch: Partial<UiState> };
```

Commands are schema-validated, applied to the document, pushed to the undo
stack, and trigger recomputation from the earliest affected stage and scope.
Each returns a `CommandResult` with ids added/removed and warnings ("port
placed 300 m east of the requested point: requested spot too shallow").

---

## 11. LLM assistant

### 11.1 Principles

1. **Prefer commands over coordinates.** The model edits through the command
   API. It may author simple geometry (a road along waypoints, a rectangle
   building) when asked, but those go through the same validation and snapping
   as a human drawing, and the pipeline fills in everything else.
2. **No backend.** Bring-your-own-key, stored only in `localStorage` if the user
   opts in, never in the document or URL, sent only to the Anthropic API.
3. **Anthropic only, via the official `@anthropic-ai/sdk`** with the SDK's
   explicit browser opt-in. The adapter interface stays small so other
   providers can be added later if wanted.
4. **Cost visibility**: token usage and estimated cost per session are shown.

### 11.2 Models and request shape

- Default model `claude-opus-5` with adaptive thinking and streaming. A
  declined request (`stop_reason: refusal`) ends the turn with a notice and
  no change; the SDK in use has no server-side fallback option, so the
  client handles it.
- `claude-sonnet-5` for bulk naming and flavour text with structured output.
- Tools use `strict: true` schemas generated from the command definitions.
- The map summary and tool definitions are placed first in the request so
  prompt caching applies across turns.

### 11.3 Tools

| Tool                                                                    | Purpose                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `get_region_summary`                                                    | Settlements, kinds, populations, networks, terrain highlights, year |
| `get_settlement_summary(id)`                                            | Districts with zone/wealth/density/era, facilities, stations, stats |
| `describe_area(polygon                                                  | featureId)`                                                         | Buildings, land use, terrain, neighbours, names |
| `find_features(query)`                                                  | By type, zone, name, bbox, property filter                          |
| `render_snapshot(bbox, layers, theme)`                                  | PNG of an area as an image block so the model can look at it        |
| `get_spec` / `patch_spec`                                               | Read and JSON-Patch the spec                                        |
| `place_feature`, `move_feature`, `remove_feature`, `freeze`, `unfreeze` | Feature edits with hints resolved by the app                        |
| `draw(layer, geometry, properties)`                                     | Authored geometry, validated and snapped                            |
| `brush(kind, region, value)`                                            | Terrain, zone, wealth, density, vegetation, year                    |
| `regenerate(scope, newSeed)`                                            | Re-run the pipeline at region/settlement/district/area scope        |
| `set_year(year)`                                                        | Move the region along its timeline                                  |
| `name_features(ids, culturePack, style)`                                | Batch naming, structured output                                     |
| `annotate(kind, geometry, text, gmOnly)`                                | Notes and labels                                                    |
| `undo` / `redo`                                                         | Shared history                                                      |

The system prompt describes units, compass, year and the rule that nothing is
reported as done unless a tool succeeded. Multi-step requests are handled by
several tool calls per turn; warnings in results let the model adapt.

### 11.4 Conversation flow

- The assistant drawer shows tool calls as cards with an inline undo.
- Each session starts with an automatic `get_region_summary`; when the user has
  a settlement or selection focused, its summary is included too.
- Old tool results are trimmed; the latest summaries are kept to bound context.
- An **evaluation set** of scripted requests with expected command outcomes runs
  in CI against recorded responses and periodically live.

### 11.5 Headless reuse

`core`, `features` and `llm` tool definitions have no DOM dependency, so the
same tool set is exposed as an **MCP server** and a **CLI**
(`citygen generate region.citygen.json --png harbour.png --bbox …`).

---

## 12. Suggested additional features

Now that the scope is metropolitan and the editor is full, these are candidate
roadmap items rather than a wish list; see ROADMAP.md for where they land.

**Play-focused (Call of Cthulhu first)**

- **Period content packs**: 1890s and 1920s–30s New England and English
  settings with era-correct amenities (speakeasies as unmarked buildings,
  telephone exchanges, boarding houses, dime museums, trolley barns, gasworks,
  canneries, asylums, sanatoria, observatories, funeral parlours).
- **Business and resident directory**: every non-residential building gets a
  named business and every address a household, generated from culture packs,
  searchable in the editor, and exportable as a directory handout. The
  assistant can answer "who lives at 14 Ash Street?".
- **Sanborn and period-atlas themes** for authentic handouts.
- **Handout frames**: named export rectangles with their own theme, layers and
  GM/player visibility, re-exportable in one click.
- **Decay and events**: a condition brush and year-based decay so a fishing
  town can look abandoned; flood, fire and storm damage as overlays.
- **Building interiors (stretch)**: generate floor plans for a selected
  building from its footprint, floors, use and era.

**General**

- **Growth timeline**: the region at any year, with a scrubber; buildings carry
  built/demolished years so the same seed shows 1890, 1925 and 1985 coherently.
- **Points of interest and institutions** as first-class feature types.
- **Utility networks**: power lines, pipelines, aqueducts, canals with locks,
  sewers as GM-only layer.
- **3D view** via extrusion (cheap given MapLibre) and later a glTF export.
- **Culture/style packs** beyond the initial five; naming grammars.
- **OSM import** as a starting document; **DEM import**.
- **PWA offline**, **gallery** of shared documents (as GitHub gists), **plugin
  registry** for community feature types, localisation.

---

## 13. Licensing and provenance

Decided: **clean-room reimplementation** under the **MIT licence**, with the
copyright held by "CityGenerator contributors" (see `LICENSE`). Contributors
must not copy code from the GPL-3.0 reference; the ideas summarised in §2 are
used, not the source. This policy goes in CONTRIBUTING.md.

---

## 14. Risks and mitigations

| Risk                                                       | Impact                      | Mitigation                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Ink theme in MapLibre looks too "GIS", not hand-drawn      | Loses the reference's charm | Phase 1 spike with sketch jitter, hatch sprites, cased lines; PixiJS fallback behind the tile source                                          |
| Lazy block generation shows seams or popping at tile edges | Ugly                        | Block-keyed generation shared across tiles; deterministic per-tile terrain detail with edge-consistent noise; visual tests at tile boundaries |
| Region-scale eager stages too slow on big documents        | Sluggish editing            | Scope-limited recomputation (settlement/district/area), worker pool, budgets in CI                                                            |
| Authored/generated conflicts produce broken geometry       | Trust                       | Conflict rules favour the user; inspector explains cuts; geometry validity tests on every command                                             |
| Document migrations break old files                        | Data loss                   | Versioned schema, migration tests with fixture documents from each release                                                                    |
| Browser-side API keys misused                              | Cost                        | Opt-in storage, warnings, never in document/URL, per-session cost display                                                                     |
| Scope creep from the feature library                       | Never ships                 | Each facility is a roadmap item with an acceptance test; library is data so contributions scale                                               |
| GPL contamination                                          | Licence dispute             | Clean-room policy; no copied code                                                                                                             |

---

## 15. Decision log

| #   | Decision                                                                 | Alternatives                | Rationale                                                                                                                  |
| --- | ------------------------------------------------------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | TypeScript + Vite + React                                                | Svelte, SolidJS             | Owner decision; largest contributor pool                                                                                   |
| 2   | GeoJSON as the model format                                              | Custom binary, ECS          | Interoperability and readability; tiles solve the size problem                                                             |
| 3   | MapLibre GL with in-browser tiles                                        | Canvas 2D, PixiJS, deck.gl  | Metropolitan scale needs LOD, culling, label collision; MapLibre is the standard; PixiJS kept as fallback for the ink look |
| 4   | Lazy block-level generation                                              | Generate everything eagerly | Millions of buildings cannot be generated or held eagerly; blocks are the natural unit                                     |
| 5   | Year, not an era enum                                                    | Enum of eras                | Continuous timelines, mixed-era rings, growth scrubber                                                                     |
| 6   | Document = spec + authored + overrides + annotations, unconstrained size | Tiny URL-only spec          | Owner decision; full editor needs authored geometry; JSON import/export is the persistence contract                        |
| 7   | Browser-side BYOK, Anthropic only                                        | Proxy, multi-provider       | Owner decision; adapter interface left in place                                                                            |
| 8   | Clean-room, permissive licence                                           | GPL port                    | Owner decision                                                                                                             |
| 9   | Own PRNG with named and tile-derived streams                             | Global `seedrandom`         | Local streams keep unrelated stages stable; tile derivation enables laziness                                               |

---

## 16. Change history

- **v0.12** — Phase 10 third slice: facility-part interiors (programmes by
  part name and kind, the front edge facing the facility's centre), hosted
  pack registries (one index format for the Gallery and `citygen packs`),
  and localisation of the interface (English keys, per-locale dictionaries
  with a coverage test, locale in `localStorage`).
- **v0.11** — Phase 10 second slice: building interiors (the stretch
  project from §12), the gallery, community pack index and share links.
  Implementation notes: plans are pure functions of the building id,
  footprint, floors, use and built year; the area partition cuts
  perpendicular to the oriented box's long axis to the programme's shares,
  front rooms on the street end; doors form a spanning tree with halls and
  corridors as hubs; VTT scenes carry the walls as line of sight and doors
  as portals.
- **v0.10** — Phase 10 (ecosystem) first slice: the headless engine package,
  the command line and MCP server (§11.5), OSM and heightmap import,
  plugins carried in the document, offline install, open from URL.
  Implementation notes: the worker is a thin Comlink wrapper over
  `createEngine()`; imported heightmaps are a base64 16-bit grid so no image
  decoder is needed in the engine; document-level packs are registered per
  engine run and shadow built-ins by id.
- **v0.9** — Phase 9 delivered: the timeline, condition, disasters and 3D.
  Decision: the spec's populations are as of an anchor year (`anchorYear`);
  each settlement follows one growth curve through it, so the year slider
  never rescales the past. Implementation notes: the old town is laid out
  at its final extent and filtered by built year; ring boundaries for past
  eras come from the curve; grid cells use per-cell randomness and stable
  ids; artery cuts use a fixed far point so splits are bit-identical; ring
  zoning samples a society computed at the anchor year; lots keep a list of
  building episodes (first build, zoning changes, fires) and show the one
  standing at the year.
- **v0.8** — Phase 8 delivered: the assistant package, tools, drawer and
  evaluation set. Implementation notes: tool schemas come from zod and are
  made strict (all properties required, optionals nullable, numeric
  constraints kept only for local validation); the session primes each
  conversation with the region summary and trims old tool results; renames
  are `setProperty` overrides applied in the engine worker.
- **v0.7** — Phases 4–7 delivered: the editor, rail and trams, the placement
  engine and facility library, culture packs with naming, addresses and the
  directory, five more themes, and export (PNG, SVG, GeoJSON, Universal VTT
  and Foundry with capped walls). Implementation notes: MapLibre labels need
  glyph PBFs, so Open Sans is vendored under `apps/web/public/fonts`; the
  export model is assembled in the worker for a frame and the live
  document's annotations are overlaid on the main thread, so GM notes added
  since the last generation still export.
- **v0.6** — Phase 3 delivered: era profiles, society fields with overlays,
  growth rings with modern zones, the inspector.
- **v0.5** — Phase 2 delivered: settlement siting, the organic town, lazy
  blocks and regional roads (decision log 12–13).
- **v0.4** — Phase 1 delivered: recorded the marching-squares, noise and PNG
  decisions and the ink-spike verdict (decision log 10–11).
- **v0.3** — Closed the remaining questions: MIT licence held by
  "CityGenerator contributors"; biome and culture as independent, worldwide
  axes with an initial pack list; scale compression on by default; Universal
  VTT walls with a performance guard.
- **v0.2** — Applied owner decisions: metropolitan regions (hierarchical,
  lazy generation; MapLibre rendering), full editor with authored/frozen
  geometry and brushes, year-based eras with Call of Cthulhu period focus,
  unconstrained document size with JSON import/export, BYOK Anthropic-only
  assistant, clean-room licence, React. Removed effort estimates from the
  roadmap; expanded ambition.
- **v0.1** — Initial draft.
