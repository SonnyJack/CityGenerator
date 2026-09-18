# CityGenerator — Design Document

Status: **Draft v0.1** (for review)
Audience: contributors, reviewers, and anyone deciding whether to build this.

This document describes a browser-based procedural city generator for tabletop
maps. It is inspired by watabou's
[Medieval Fantasy City Generator (TownGeneratorOS)](https://github.com/watabou/TownGeneratorOS)
and extends it with modern infrastructure (rail, ports, industry), explicit
wealth and density modelling, a general feature-placement and gap-filling
system, topography, and an LLM assistant that can answer questions about a map
and edit it.

The companion documents are:

- [ROADMAP.md](./ROADMAP.md) — phased delivery plan with acceptance criteria.
- [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md) — clarifying questions that need answers
  before or during Phase 1, plus suggested extra features.

---

## 1. Goals and non-goals

### 1.1 Goals

1. **Generate believable city maps** across eras (medieval → industrial → modern)
   from a small set of parameters and a seed, deterministically.
2. **Model modern infrastructure**: railways, train yards, container ports, dry
   docks, industrial zones and facilities, with realistic siting rules.
3. **Model wealth and density** as first-class, continuous fields that drive
   layout, building style, and rendering, and are visible as overlays.
4. **General placement engine**: a declarative rule system for positioning any
   feature (built or natural), manual pinning, and multi-pass "gap filling" so
   there is no unexplained empty land.
5. **Topography**: a heightmap with hydrology (rivers, lakes, coast), slope
   constraints, contour rendering, and terrain-aware road and rail routing.
6. **Run as a static site on GitHub Pages**: no backend required for generation,
   editing, or export. Maps are shareable by URL.
7. **LLM integration**: a chat panel where the user can ask questions about the
   current map and request changes in natural language; the assistant edits the
   map through the same command API the UI uses.
8. **Industry-standard stack**: TypeScript, Vite, React, GeoJSON, Web Workers,
   GitHub Actions, official LLM SDKs. No exotic languages or toolchains.

### 1.2 Non-goals (for the initial versions)

- Real-world geodata import (OpenStreetMap) as a starting point. Possible later.
- Full 3D rendering. An isometric/3D view is a stretch feature (see §12).
- Multiplayer or collaborative editing.
- Simulation of traffic, economy, or population over time (a simple "growth
  timeline" is a stretch feature).
- Pixel-perfect reproduction of watabou's output. We take the ideas, not the code
  (see §13 on licensing).

### 1.3 Primary user stories

- *As a game master*, I generate a modern port city with a seed, tweak sliders,
  print it with a 5 ft grid, and export a VTT-ready image.
- *As a worldbuilder*, I paint a rough terrain (a bay, a river, hills), ask for a
  wealthy district on the hill and heavy industry downwind by the rail line, and
  iterate with the assistant: "move the train yard next to the port".
- *As a developer*, I add a new feature type ("oil refinery") by writing a JSON
  definition and, optionally, a small TypeScript scorer, without touching the
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

**What we keep:** the patch/ward decomposition, `rateLocation`-style scoring,
gate-driven artery generation, recursive lot subdivision, seeded determinism and
URL-shareable parameters, and the clean ink aesthetic.

**What we change:**

| Limitation in the reference | Our approach |
|---|---|
| One global Voronoi partition; no notion of terrain | Terrain layer first; partition respects water, slope and the street network |
| Wards are discrete, hand-picked classes | Continuous wealth/density fields, discretised into classes per district; ward types become data-driven **zone profiles** |
| Only pre-modern features | Feature library with era gating: rail, yards, ports, dry docks, industry, and more |
| Placement is implicit in ward selection | Explicit **placement engine** with constraints, scoring, orientation, and manual pins |
| Empty land outside wards | Multi-pass **fill** system (parcels → buildings → greenery → texture) |
| Streets only from gates to plaza | Road hierarchy (motorway/arterial/collector/local), grid and organic patterns, rail and water networks as separate graphs |
| No editing after generation | Command-based editing with undo; UI and LLM use the same commands |

---

## 3. System overview

```
┌─────────────────────────────── Browser (GitHub Pages) ───────────────────────────────┐
│                                                                                      │
│   ┌──────────────┐    commands     ┌──────────────────┐   CitySpec    ┌────────────┐ │
│   │  UI (React)  │ ──────────────▶ │  Command bus /   │ ────────────▶ │  Worker:   │ │
│   │  panels,     │                 │  store (Zustand) │               │  core      │ │
│   │  canvas      │ ◀────────────── │  undo/redo, URL  │ ◀──────────── │  pipeline  │ │
│   └──────────────┘   CityModel     └──────────────────┘   CityModel   └────────────┘ │
│          ▲                                  ▲                                        │
│          │ render                           │ tool calls (same commands)             │
│   ┌──────┴───────┐                  ┌───────┴────────┐        HTTPS (BYOK)           │
│   │  Renderers   │                  │  LLM assistant │ ───────────────────▶ Claude   │
│   │  Canvas/SVG  │                  │  (tool use)    │                        API    │
│   └──────────────┘                  └────────────────┘                               │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Three ideas hold the design together:

1. **Spec in, model out.** A small, serialisable `CitySpec` (seed + parameters +
   user overrides) is the only input. The generation pipeline turns it into a
   large derived `CityModel`. The spec is what goes in the URL, in saved files,
   and in undo history. The model is never edited directly.
2. **Everything is a command.** UI controls, manual edits and LLM tool calls all
   dispatch typed commands that mutate the spec. This gives undo/redo, URL
   sharing, and LLM safety for free.
3. **Stages are pure and cached.** The pipeline is a DAG of stages keyed by a
   hash of their inputs. Changing the style re-renders only; moving a pin re-runs
   placement and fill but not terrain.

---

## 4. Technology choices

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Industry standard, runs in browser and Node (for tests, CLI, MCP server) |
| Build / dev | Vite | Fast, static output, first-class Web Worker support |
| UI | React 19 + Zustand + Tailwind CSS | Widely known; Zustand keeps state simple and serialisable |
| Forms | JSON Schema for `CitySpec` + generated form (`@rjsf` or hand-built) | One schema drives validation, the UI, the URL codec, and LLM tool schemas |
| Geometry | `d3-delaunay` (Voronoi), `polygon-clipping` (boolean ops), `flatbush`/`rbush` (spatial index), `simplify-js`, `poisson-disk-sampling` | Mature, small, deterministic |
| Terrain | `simplex-noise` / `open-simplex-noise`, `d3-contour` (marching squares) | Standard noise + contour extraction |
| Data model | GeoJSON `FeatureCollection` in local planar metres + typed `properties` | Interoperable (QGIS, turf.js, any GIS tool), trivially serialisable |
| Randomness | Own seeded PRNG (xoshiro128** or PCG32) with named sub-streams | Determinism across browsers; `Math.random` is banned in `core` |
| Rendering | Canvas 2D for the interactive view; SVG for export; shared scene description | Canvas handles 100k+ polygons with culling and LOD; SVG gives crisp print and editable vectors |
| Concurrency | Web Worker via `comlink` | Keeps the UI at 60 fps during 1–3 s generations; also allows cancellation |
| URL state | `CitySpec` → JSON → `lz-string` → URL hash | Shareable links like the reference project, without a backend |
| Persistence | `localStorage` (recent maps, settings), file download/upload (`.city.json`) | No backend |
| LLM | `@anthropic-ai/sdk` in the browser (BYOK), provider adapter interface | Official SDK; tool use; vision for "look at the map" questions |
| Testing | Vitest (unit, golden-seed snapshots), Playwright (e2e + visual regression) | Standard |
| CI/CD | GitHub Actions → `gh-pages` deployment via `actions/deploy-pages` | Required by the "GitHub site" goal |
| Repo | pnpm workspaces monorepo | Separates engine from app so the engine can be reused (CLI, MCP, tests) |

### 4.1 Repository layout

```
CityGenerator/
├── apps/
│   └── web/                 # Vite + React site deployed to GitHub Pages
├── packages/
│   ├── core/                # generation engine: spec, stages, geometry, features (no DOM)
│   ├── render/              # scene builder, Canvas renderer, SVG exporter, themes
│   ├── llm/                 # provider adapters, tool definitions, system prompts
│   ├── features/            # built-in feature library (JSON + scorers)
│   ├── exporters/           # PNG, PDF, GeoJSON, VTT formats
│   └── mcp/                 # (later) MCP server exposing the same tools headlessly
├── docs/                    # this design doc, roadmap, ADRs
└── .github/workflows/       # ci.yml (lint, test), pages.yml (deploy)
```

---

## 5. Data model

### 5.1 `CitySpec` (input)

Small, declarative, versioned. Everything the user or the assistant can change
lives here.

```ts
interface CitySpec {
  version: 1;
  seed: string;                       // any string; hashed into the PRNG
  name?: string;
  extent: { widthM: number; heightM: number };   // map size in metres
  era: 'medieval' | 'renaissance' | 'industrial' | 'modern' | 'nearFuture';
  population?: number;                // drives size/density defaults

  terrain: {
    preset: 'plains' | 'coast' | 'bay' | 'riverValley' | 'hills' | 'island' | 'delta' | 'custom';
    relief: number;                   // 0..1 vertical exaggeration
    seaLevel: number;                 // metres
    roughness: number;                // noise octaves/persistence
    rivers: { count: number; minLength: number };
    edits?: TerrainEdit[];            // user brush strokes: raise/lower/flatten/water
    importedHeightmap?: { dataUrl: string; minM: number; maxM: number };
  };

  society: {
    wealth: FieldParams;              // baseline, gradient, noise, painted overrides
    density: FieldParams;
    inequality: number;               // spread between richest and poorest districts
  };

  networks: {
    streetPattern: 'organic' | 'grid' | 'radial' | 'mixed';
    blockSizeM: number;
    roads: { motorways: number; arterials: number; ringRoad: boolean };
    rail: { enabled: boolean; mainlines: number; stations: number; freight: boolean };
    water: { port: boolean; canals: boolean };
  };

  features: FeatureRequest[];         // e.g. { type: 'containerPort', size: 'large', pin?: Pose, lock?: true }
  walls?: { enabled: boolean; citadel: boolean };

  style: { theme: string; labels: boolean; grid?: GridSpec; overlays: OverlayId[] };
  overrides: Override[];              // targeted patches produced by editing (see §10)
}
```

Design notes:

- **Presets over parameters.** Most users touch `era`, `terrain.preset`,
  `population`, and a handful of sliders. Everything else has defaults derived
  from those.
- **Overrides are append-only patches** (`{ target, op, value }`) so that
  "regenerate with a new seed but keep my pinned port" is well defined.
- The spec has a JSON Schema. It validates uploads, drives the parameter UI, and
  is reused verbatim as the `input_schema` of the LLM's `update_spec` tool.

### 5.2 `CityModel` (output)

Large, derived, never hand-edited. Serialisable for export and caching.

```ts
interface CityModel {
  spec: CitySpec;                     // the exact spec that produced it
  crs: { unit: 'm'; origin: [number, number]; cellSizeM: number };

  terrain: {
    height: Float32Array; width: number; height_: number;   // heightmap grid
    slope: Float32Array; aspect: Float32Array;
    waterMask: Uint8Array;            // sea, lake, river
    flowAccum: Float32Array;
    contours: Feature<MultiLineString>[];      // at style-defined intervals
    coastline: Feature<MultiPolygon>;
    rivers: Feature<LineString>[];    // with width property
  };

  fields: {
    wealth: Float32Array;             // 0..1, same grid as terrain
    density: Float32Array;
    landValue: Float32Array;          // derived; used by placement scoring
  };

  districts: Feature<Polygon, DistrictProps>[];   // zone, wealthClass, densityClass, name
  networks: {
    street: Graph<StreetNode, StreetEdge>;       // class, width, oneWay, bridge/tunnel
    rail: Graph<RailNode, RailEdge>;             // mainline/siding/yard, gradient, radius
    water: Graph<WaterNode, WaterEdge>;          // shipping lanes, canals
  };
  parcels: Feature<Polygon, ParcelProps>[];
  buildings: Feature<Polygon, BuildingProps>[];  // kind, floors, wealthClass, districtId
  facilities: Feature<Polygon | MultiPolygon, FacilityProps>[];  // port, yard, plant… with sub-parts
  greenery: Feature<Polygon | Point, GreenProps>[];              // parks, woods, trees, fields
  labels: Label[];
  stats: CityStats;                   // area by zone, population estimate, km of rail, berths…
}
```

All `Feature`s are standard GeoJSON with an `id` and typed `properties`. The
grid arrays share one raster definition so fields can be sampled cheaply.

### 5.3 Coordinate system

Local planar metres, origin at map centre, x east, y north. Renderers flip y.
Exports to GeoJSON stay planar (a synthetic CRS is declared in metadata); if a
user wants a real-world anchor later, an affine transform to a chosen
lon/lat is a rendering-time concern only.

---

## 6. Generation pipeline

Stages are pure functions `(inputs, rng) → outputs`, run inside the worker,
memoised on a content hash of their inputs. Each stage receives its own named
PRNG stream (`rng.fork('terrain')`) so that changing one parameter does not
reshuffle unrelated stages.

```
 1. Terrain        heightmap → hydrology → water masks → coast/rivers → slope
 2. Site           city centre(s), buildable mask, growth axes, era profile
 3. Society fields wealth, density, land value (from centre distance, terrain, noise, pins)
 4. Macro network  motorways/arterials/ring, rail mainlines, shipping approach
 5. Districts      partition buildable land into districts; assign zone profile
 6. Placement      large facilities (ports, yards, plants, stadiums…) with constraints
 7. Local network  streets inside districts (grid/organic), spurs, sidings, quays
 8. Parcels        subdivide blocks into lots per zone/wealth/density
 9. Buildings      footprints and attributes per parcel
10. Fill           parks, woods, fields, lots, yards, trees; texture in leftovers
11. Labels & stats naming, label placement, summary statistics
12. Scene          renderer-agnostic draw list (done in `render`, not `core`)
```

Stages 4–7 form a loop in practice: a placed port requests a rail spur and a
quay road; those are added to the networks and the districts are re-cut around
them. We implement this as **placement emits network requests** that the local
network stage fulfils, with at most one extra pass to avoid oscillation.

### 6.1 Terrain (Goal 5)

- **Heightmap generation**: fractional Brownian motion (simplex) with domain
  warping, blended with a preset *shape function* (coast gradient, valley
  profile, island falloff, bay mask). Resolution defaults to 2–5 m per cell,
  capped at ~1024² cells for interactive speed.
- **User edits**: brush strokes stored in the spec (`raise`, `lower`, `flatten`,
  `water`, `smooth`) are replayed after generation. **Imported heightmaps**
  (8/16-bit PNG) replace the noise.
- **Hydrology**: priority-flood depression filling, D8 flow direction, flow
  accumulation; rivers where accumulation exceeds a threshold, widened by
  accumulation; lakes where filling raised terrain; sea where height < sea level.
  Rivers are extracted as smoothed polylines with width, then buffered to
  polygons for rendering and collision.
- **Derived rasters**: slope, aspect, distance-to-water, distance-to-sea,
  bathymetry (depth below sea level, needed for ports).
- **Contours** via marching squares at style-chosen intervals; **hillshade** as a
  precomputed raster for the terrain layer.
- **Constraints for later stages**: buildable = slope < `maxSlope(zone)` and not
  water; flat land is scarce in hill presets, which naturally pushes industry to
  valley floors and wealthy housing onto slopes with views.
- **Terrain-aware routing**: major roads and rail use A* on the raster with cost
  = distance × (1 + k·slope) and a hard gradient cap (rail: ~2.5%, motorway:
  ~6%, local streets: ~12%). When the path must cross water or exceed the cap we
  insert **bridges**, **cuttings/embankments** or **tunnels**, recorded on the
  edge and rendered distinctly. Local streets on slopes are aligned along
  contours (terraces) rather than straight down them.

### 6.2 Society fields: wealth and density (Goal 3)

Two scalar rasters in `[0,1]`, plus a derived land-value raster.

```
density(p) = σ( a·centreProximity(p) + b·transitAccess(p) + c·flatness(p) + noise )
wealth(p)  = σ( d·elevationAdvantage(p) + e·waterfrontAmenity(p) + f·distanceFromNuisance(p)
              − g·industrialProximity(p) − h·railNoise(p) + i·paintedOverrides(p) + noise )
```

- `centreProximity` uses the site's growth axes (multi-centre cities supported).
- `nuisance` sources: heavy industry, rail yards, ports, power plants, prevailing
  wind direction (downwind = poorer). The fields therefore depend on placement,
  so they are computed twice: once before placement (coarse), once after.
- `inequality` scales the spread; `era` shifts the baseline (medieval density is
  high inside walls and near zero outside).
- **Discretisation**: each district takes the area-weighted mean and is assigned
  `wealthClass ∈ {slum, poor, modest, comfortable, affluent, elite}` and
  `densityClass ∈ {rural, suburban, low, medium, high, core}`.
- **Effects** (encoded in zone profiles, §7): lot size, building footprint and
  height, setback, street width and pattern (cul-de-sacs for affluent suburbs,
  tight grids for poor dense areas, courtyards for elite), tree density, park
  probability, quality of road surface, presence of amenities.
- **Rendering**: choropleth overlays for wealth and density (colour on screen,
  hatch patterns in print themes), legends, and per-district labels.

### 6.3 Districts and zone profiles

The buildable mask is partitioned into **districts**:

- *Organic eras*: relaxed Voronoi patches (as in the reference) clipped to the
  buildable mask and split by rivers and major roads.
- *Grid eras*: the macro network defines super-blocks; districts are unions of
  super-blocks with similar field values.
- *Mixed*: an organic old town core (optionally walled, with remnants) surrounded
  by a grid.

Each district gets a **zone profile**, chosen by a scoring function over the
fields and adjacency (the generalisation of `rateLocation`). Zone profiles are
data (JSON), for example:

```jsonc
{
  "id": "industrial.heavy",
  "eras": ["industrial", "modern", "nearFuture"],
  "prefers": { "density": [0.2, 0.7], "wealth": [0, 0.35], "slope": [0, 0.03] },
  "adjacency": { "wants": ["rail.mainline", "water.deep", "road.arterial"], "avoids": ["residential.affluent"] },
  "lots": { "minAreaM2": 4000, "maxAreaM2": 60000, "regularity": 0.9 },
  "streets": { "pattern": "grid", "widthM": 14, "blockM": 250 },
  "buildings": { "kinds": ["shed", "hall", "tankFarm", "chimney"], "coverage": 0.45 },
  "fill": ["parking", "storageYard", "scrub"]
}
```

Built-in profiles cover the reference's wards (market, craftsmen, merchant,
patriciate/elite, slum, military, administration, cathedral/civic, park, farm,
gate) and modern ones (CBD, residential at each wealth/density combination,
retail strip, light/heavy industry, logistics, port, rail, institutional,
campus, airport reserve).

### 6.4 Networks

Three separate graphs (street, rail, water) with shared node types where they
interact (level crossings, bridges, ferry piers, port gates).

- **Road hierarchy**: motorway → arterial → collector → local. Macro roads are
  routed on the terrain raster between entry points on the map edge and the city
  centres, then the ring road (if any). Local streets are generated per district
  according to its profile: grid (with jitter and occasional diagonals), organic
  (space-colonisation / growth from arterials, as in the reference's artery
  logic), radial, or cul-de-sac trees.
- **Rail** (Goal 1): mainlines enter at 1–3 map edges and pass near, not
  through, the centre; a **central station** sits at the mainline/centre closest
  approach. Constraints: minimum curve radius (scaled by map size), gradient cap,
  no tight zig-zags. Freight **spurs** and **sidings** branch to industrial
  districts and the port. Level crossings on local streets; bridges/underpasses
  on arterials. Tracks are rendered as parallel lines with sleepers at high zoom.
- **Water**: shipping approach lane from the map edge along the deepest
  bathymetry to the port; canals (industrial era) as straight cut waterways with
  locks if terrain requires.

### 6.5 Placement engine (Goal 4)

A single engine places every "large" thing: ports, rail yards, industrial
plants, stadiums, cemeteries, castles, cathedrals, parks, woods, farms, and
user-defined features. A **feature type** declares:

```ts
interface FeatureType {
  id: string;                          // 'containerPort'
  eras: Era[];
  footprint: FixedFootprint | ParametricFootprint;   // e.g. rectangle 600–1500 m × 300–600 m
  hard: Constraint[];                  // must all pass
  soft: Scorer[];                      // weighted, summed
  orientation: 'free' | 'alignCoast' | 'alignRail' | 'alignStreetGrid';
  connectors: ConnectorRequest[];      // { network: 'rail', class: 'spur' }, { network: 'street', class: 'arterial' }
  nuisance?: { radiusM: number; strength: number };   // feeds back into wealth field
  layout: (ctx, footprintPolygon, rng) => SubFeature[];  // internal detail generator
  fill?: FillRule[];                   // how leftover space inside the footprint is used
}
```

Constraints and scorers are small, composable primitives:
`nearWater(depthM, maxDistM)`, `maxSlope(x)`, `inZone([...])`, `nearNetwork('rail', maxDistM)`,
`awayFrom('residential.affluent', minDistM)`, `downwindOf(centre)`, `flatArea(minM2)`,
`onMapEdge(side)`, `landValueBelow(x)`.

Algorithm per feature request (in priority order: user-pinned first, then largest
footprint first):

1. If pinned: validate hard constraints (warn, don't refuse), carve, done.
2. Sample candidate positions with Poisson-disk sampling over the mask where hard
   constraints pass; for each candidate try the allowed orientations.
3. Score = Σ wᵢ·scorerᵢ − overlap penalty (spatial index) − distance-from-hint
   (if the user gave a vague hint such as "north").
4. Take the best; run `layout()` to produce sub-features (berths, cranes,
   container stacks, ladder tracks, halls, tanks); emit connector requests.
5. Carve the footprint out of districts and mark nuisance for the field
   recomputation.

Failure mode: if no candidate passes, degrade (shrink footprint, relax soft
constraints) and finally report "could not place X because Y" — this message is
shown in the UI and returned to the LLM.

### 6.6 Modern facility generators (Goal 2)

Each is a `FeatureType` with a bespoke `layout()`:

| Feature | Siting (hard/soft) | Internal layout |
|---|---|---|
| **Container port** | Deep water (bathymetry ≥ 12 m equivalent) within 100 m; long straight-ish shoreline; flat; low land value; wants rail + arterial | Straight **quay** (possibly reclaimed land polygon), berths every 300 m, gantry **cranes** on quay rail, **container yard** grid of stacks with row spacing, gate complex, truck marshalling, customs buildings, **breakwater** if exposed coast, rail sidings alongside yard, optional Ro-Ro ramp and tank terminal |
| **Dry dock** | Adjacent to port/harbour, deep water | Rectangular basin cut into quay, caisson gate, pump house, workshop halls alongside, slipway variant for smaller yards; graving vs floating dock variants |
| **Rail yard** | Adjacent to a mainline, flat, elongated, near industry/port; avoids affluent | **Ladder tracks** fanning from a throat on each end, 6–30 parallel tracks, hump (optional), engine shed / roundhouse (industrial era), loco depot, container transfer cranes if intermodal |
| **Heavy industry** | Flat, near rail/water, downwind, low wealth | Large halls, tank farms (circles), chimneys/stacks, cooling towers, pipe racks, internal roads, rail siding, parking, buffer strip |
| **Light industry / logistics** | Near motorway junction, flat | Big-box warehouses with dock doors, truck yards, parking |
| **Power plant** | Water for cooling, rail/pipeline for fuel, edge of city | Turbine hall, boilers, stacks/cooling towers, switchyard with lines leaving |
| **Refinery / chemical** | Near port + rail, far from residential | Dense tank farm, process units, flare stack |
| **Marina / fishing harbour** | Sheltered shallow water | Pontoons, slipway, fish market |
| **Airport** (stretch) | Very flat, very large, outer edge | Runways aligned to prevailing wind, terminal, apron, hangars |

Sub-features are stored as `facilities[].parts[]` with their own geometry so the
renderer can draw cranes, tracks and tanks distinctly and exporters can include
them.

### 6.7 Parcels, buildings and fill (Goal 4)

- **Parcels**: each block (polygon bounded by streets or district edges) is
  subdivided with the recursive OBB-split used by the reference, parameterised by
  the zone profile (target lot area, regularity, street-frontage requirement).
  Deep blocks get back lanes or courtyards depending on era and wealth.
- **Buildings**: per parcel, a footprint generator picks a building *kind* from
  the profile and wealth/density class (row house, detached, villa, tenement,
  tower, hall, shed, big box, courtyard block…), sets setbacks, and produces the
  polygon plus `floors`, `roof`, `use`. Density class controls coverage and
  floors; wealth controls setback, garden, and irregularity.
- **Fill passes** run in order over whatever remains unassigned, at district and
  then at map level:
  1. Amenities the district is "owed" (school, church/civic, small park, market
     square) sized by population.
  2. Parks/greens in leftover polygons above a size threshold.
  3. Parking lots and yards in industrial/retail zones; allotments or cemeteries
     on the fringe.
  4. Woods on steep or wet land; fields/pasture on flat rural land (with hedge
     lines and farm buildings); scrub elsewhere.
  5. Point features: trees along affluent streets and in parks; benches, wells,
     etc. are optional style-level detail.
  6. Anything still empty and smaller than a threshold is merged into a
     neighbour; larger leftovers become "wasteland" and are reported in stats so
     the rule set can be tuned.

Fill is itself expressed as feature types with constraints, so the same engine
applies; the difference is that fill features accept any leftover polygon as
their footprint rather than searching for one.

### 6.8 Determinism and performance

- Same `CitySpec` ⇒ byte-identical `CityModel` on every browser. We use our own
  PRNG, stable sorts with explicit tie-breakers, and avoid iteration over
  `Set`/`Map` insertion orders that depend on hashing.
- Budgets (medium city, 4 × 4 km, 2 m cells, mid-range laptop): terrain < 400 ms,
  full pipeline < 2.5 s, incremental edit (pin moved) < 800 ms, render frame
  < 16 ms at any zoom. Large (12 × 12 km) full pipeline < 10 s.
- Progress and cancellation: the worker posts stage progress; a new request
  cancels the running one.

---

## 7. Feature library and extensibility

- Built-in feature types and zone profiles live in `packages/features` as JSON
  plus optional TypeScript scorers/layouts, registered by id.
- Users can paste a JSON feature definition in the UI ("custom feature"); such
  definitions can use the constraint/scorer primitives but not arbitrary code
  (no `eval`). Custom definitions are stored in the spec so URLs stay
  self-contained.
- A `FeatureType` for a natural feature (wood, marsh, quarry, cliff) is the same
  shape as one for a built feature; the engine does not distinguish.

---

## 8. Rendering

### 8.1 Scene model

`render` converts a `CityModel` plus a `Theme` into a **scene**: an ordered list
of layers, each a list of draw primitives (`fill`, `stroke`, `hatch`, `symbol`,
`text`) with style ids rather than raw colours. Both the Canvas renderer and the
SVG exporter consume the same scene, which guarantees the export matches the
screen.

Layers (bottom to top): hillshade, water, terrain contours, land use/fill,
district overlays (wealth/density, toggleable), parcels (optional), facilities,
buildings, water network, rail, streets, walls, labels, grid, annotations.

### 8.2 Interactive view

Canvas 2D with a pan/zoom transform, per-layer visibility, spatial-index
culling, and level-of-detail rules (e.g. hide individual buildings below a zoom
threshold, draw blocks as filled polygons instead). Hover and click resolve to
features via the spatial index for inspection and editing. If profiling shows
Canvas 2D is insufficient for the largest maps, a WebGL backend (PixiJS) can be
added behind the same scene interface; this is deliberately not a Phase 1 risk.

### 8.3 Themes

`ink` (reference-like black and white), `parchment`, `blueprint`, `atlas`
(modern colour map), `dark`, and `print` (hatch patterns instead of colour, CMYK-
friendly). Themes are JSON style sheets keyed by feature class and
wealth/density class.

### 8.4 Export

- **PNG** at chosen DPI and area (with optional 1 in / 5 ft grid).
- **SVG** (editable layers, labels as text).
- **PDF** for print: tiled across pages with overlap and crop marks (via
  `pdf-lib`, drawing the SVG scene).
- **GeoJSON** of the full model (planar CRS declared) for GIS tools.
- **VTT formats**: Universal VTT (`.dd2vtt`) with optional wall lines derived
  from building outlines; Foundry scene JSON. Others on request.
- **`.city.json`**: the `CitySpec` (tiny) for sharing and re-import.

---

## 9. Application UI

- **Map canvas** centre; **parameter panel** left (generated from the spec
  schema, grouped: Basics / Terrain / Society / Networks / Features / Style);
  **layer & legend panel** right; **assistant** as a collapsible drawer; **export**
  dialog; **inspector** popover on click (feature properties, "why is this
  here?" showing the winning constraint scores).
- **Edit tools**: terrain brush; paint wealth/density; place/drag/rotate/lock a
  feature; draw a road/rail line as a hint; delete; regenerate-from-stage.
- **History**: undo/redo over commands; a "variations" strip showing 6 thumbnails
  with different seeds for the same spec.
- **Sharing**: the URL hash always reflects the current spec. Long specs (many
  overrides) are compressed; if still too long the UI offers a file download
  instead.
- Keyboard accessible; colour-blind-safe default overlay palettes.

---

## 10. Editing and the command API

All mutations go through one bus:

```ts
type Command =
  | { type: 'spec.set'; path: JsonPointer; value: unknown }
  | { type: 'spec.patch'; ops: JsonPatchOp[] }            // RFC 6902
  | { type: 'feature.add'; request: FeatureRequest }
  | { type: 'feature.move'; id: string; pose: Pose; lock?: boolean }
  | { type: 'feature.remove'; id: string }
  | { type: 'terrain.brush'; stroke: TerrainEdit }
  | { type: 'field.paint'; field: 'wealth' | 'density'; stroke: FieldEdit }
  | { type: 'network.hint'; network: 'street' | 'rail' | 'water'; line: LineString; class: string }
  | { type: 'regenerate'; fromStage?: StageId; newSeed?: boolean; keepPinned?: boolean }
  | { type: 'style.set'; patch: Partial<StyleSpec> };
```

Commands are validated against the schema, applied to the spec, pushed onto the
undo stack, and trigger a pipeline run from the earliest affected stage. Each
command returns a `CommandResult` with what changed (ids added/removed, warnings
such as "port placed 300 m from requested position: requested spot too shallow").
The UI, the URL codec, tests, the future CLI, and the LLM all speak this API.

---

## 11. LLM integration (Goal 7)

### 11.1 Principles

1. **The model never draws.** It reads summaries and issues commands; the
   deterministic pipeline produces geometry. This keeps outputs valid,
   reproducible, and undoable.
2. **No backend.** The site is static. The user supplies their own API key
   (BYOK), stored only in `localStorage` if they opt in, never in the URL or
   spec. The key is sent only to the provider's API.
3. **Provider adapter.** A small interface (`chat(messages, tools) → stream`)
   with Anthropic as the first and default implementation via the official
   `@anthropic-ai/sdk` (browser mode requires the SDK's explicit
   `dangerouslyAllowBrowser` opt-in, which is exactly the BYOK case). Additional
   adapters (OpenAI-compatible endpoints, local Ollama) are welcome contributions
   behind the same interface.
4. **Cost visibility.** Token usage and estimated cost per session are shown.

### 11.2 Models

- Default: `claude-opus-5` with adaptive thinking for editing and reasoning
  about the map.
- `claude-sonnet-5` for high-volume, low-stakes tasks: naming streets and
  districts, writing flavour text.
- Requests use streaming; the server-side refusal `fallbacks` option is enabled
  so a declined request degrades gracefully instead of failing.

### 11.3 Tools exposed to the model

All tools are thin wrappers over the command API and read-only queries; their
JSON schemas are generated from the same Zod/JSON-Schema definitions used for
validation.

| Tool | Purpose |
|---|---|
| `get_city_summary` | Compact structured overview: era, size, districts with zone/wealth/density, facilities, networks (km of rail, stations, berths), water bodies, notable terrain, stats |
| `get_spec` / `update_spec` | Read the spec; apply a JSON Patch (validated) |
| `list_features(filter)` | Query features by type, zone, area, bounding box |
| `describe_area(polygon | featureId)` | Detailed description of one region (buildings, land use, terrain, neighbours) |
| `add_feature`, `move_feature`, `remove_feature`, `lock_feature` | Feature edits with hints such as "north of the station" resolved to positions by the app |
| `paint_field(field, region, value)` | Raise/lower wealth or density in an area |
| `edit_terrain(op, region, value)` | Terrain brush ops |
| `add_network_hint` | Suggest a road/rail/canal alignment |
| `regenerate(fromStage, keepPinned)` | Re-run the pipeline |
| `render_snapshot(bbox, layers)` | Returns a PNG of the current map (or an area) as an image block so the model can *look* at it for questions like "what is on the hill north-west of the port?" |
| `name_features(ids, style)` | Batch-name streets/districts (usually on the cheaper model, structured output) |
| `undo` / `redo` | Same stack as the UI |

The system prompt describes the map's conventions (units, compass, era) and the
rule that changes are proposed via tools, never described as done unless a tool
succeeded. Multi-step requests ("add a container port and connect it by rail to
the yard") are handled by the model calling several tools in one turn; results
include warnings so it can adapt (e.g. "no deep water on the west coast; try
east?").

### 11.4 Conversation flow

- The chat panel shows tool calls as collapsible cards ("Placed container port at
  (1200, −300), 4 berths") with an inline **undo** button.
- The first user message of a session is preceded by a `get_city_summary` call
  the app performs automatically, so the model starts with context.
- Long sessions use the SDK's message history; the app trims old tool results
  and keeps the latest summary to bound context.

### 11.5 Headless reuse (later)

Because `core` and the tools have no DOM dependency, the same tool set can be
exposed as an **MCP server** (`packages/mcp`) for desktop assistants and
automation, and as a **CLI** (`citygen generate spec.json --png out.png`). This
is roadmap Phase 7.

---

## 12. Suggested additional features

Grouped by how strongly we recommend them. These are also listed in
[OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md) for prioritisation.

**Recommended for v1**

- **Era slider with mixed eras**: old town core + modern periphery is the most
  common real-world shape and the most useful for games.
- **Naming and labels**: Markov-chain/wordlist generator by culture pack, LLM
  refinement optional; street, district, water and facility labels with
  collision-avoiding placement.
- **Grid overlays and print tiling** for tabletop use (square/hex, scale bar,
  compass rose, legend).
- **"Why is this here?" inspector** showing constraint scores — invaluable for
  tuning and for users' trust.
- **Variations strip** (six seeds at a glance) and **history thumbnails**.

**Recommended for v2**

- **Points of interest layer**: hospitals, schools, police/fire, stadium,
  university campus, prison, water treatment, cemetery, military base, with the
  same placement rules.
- **Utility networks**: high-voltage lines from the power plant, pipelines from
  the refinery to the port, canals with locks.
- **Growth timeline**: generate the city at year *t* by animating population and
  era; useful for campaigns spanning decades.
- **Condition layer**: ruins, abandonment, war damage, flooding (raise sea
  level and see the port drown).
- **Isometric/3D view** (three.js) with extruded buildings, for reference
  imagery rather than editing.
- **Player-facing export**: fog-of-war friendly layers, removing GM-only labels.

**Nice to have**

- Culture/style packs (Northern European, Mediterranean, East Asian, colonial
  grid…), OSM import as a starting spec, PWA offline install, gallery of shared
  specs (stored as gists or repo issues, no backend), plugin registry for
  community feature types, localisation.

---

## 13. Licensing and provenance

TownGeneratorOS is GPL-3.0. Two options:

1. **Clean-room reimplementation** (recommended): we borrow the *ideas*
   documented in §2, write all code from scratch in TypeScript, and may choose a
   permissive licence (MIT/Apache-2.0). Contributors must not paste code from the
   reference. This maximises reuse by the tabletop community.
2. **Port the reference**: faster start for the medieval core, but the project
   must be GPL-3.0 and the boundary between ported and original code has to be
   tracked.

This document assumes option 1; it is listed as an open question.

---

## 14. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Placement rules produce implausible results for some presets | Poor first impression | Golden-seed visual tests per preset; "why is this here?" inspector; tuning sprint in each phase |
| Performance on large maps in Canvas 2D | Laggy UI | Worker isolation, LOD, budgets in CI; WebGL backend behind the scene interface if needed |
| Determinism drifts across browsers (floating point in geometry libs) | Broken share links | Own PRNG, pinned library versions, snapshot tests run on Chromium + WebKit + Firefox in CI |
| Browser-side API keys are misused or leak | User cost / trust | Opt-in storage, clear warning, never in URL/spec, per-session cost display; optional self-hosted proxy documented for teams |
| Scope creep (every facility is a project) | Never ships | Feature library is data-driven; each facility is a separate roadmap item with its own acceptance test |
| GPL contamination | Licence dispute | Clean-room policy in CONTRIBUTING.md; no code copied from the reference |

---

## 15. Decision log

| # | Decision | Alternatives considered | Rationale |
|---|---|---|---|
| 1 | TypeScript + Vite + React | Svelte, SolidJS, plain TS | Largest contributor pool; Svelte is a reasonable swap if the owner prefers it (open question) |
| 2 | GeoJSON as the model format | Custom binary, ECS | Interoperability, tooling, and readability outweigh size |
| 3 | Canvas 2D + SVG export from one scene | SVG-only, MapLibre GL, PixiJS | SVG-only does not scale to modern cities; MapLibre assumes lon/lat and tile styling; PixiJS kept as an upgrade path |
| 4 | Spec/model split with command bus | Mutable model editing | Undo, URL sharing, and safe LLM editing all fall out of it |
| 5 | Browser-side BYOK for LLM | Serverless proxy | GitHub Pages cannot host a proxy; a proxy is documented as optional |
| 6 | Own PRNG with named streams | `seedrandom` global | Local streams keep unrelated stages stable when one parameter changes |
| 7 | Clean-room reimplementation | Port of the GPL reference | Licence freedom (pending owner's confirmation) |
