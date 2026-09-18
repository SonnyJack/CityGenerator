# CityGenerator — Roadmap

Status: **Draft v0.1**. Effort estimates assume **one to two part-time
developers** and are ranges of calendar weeks; they will be revised once the
open questions are answered. Each phase ends with a deployed site on GitHub
Pages so there is always something to try.

Phases are ordered so that every phase produces a usable generator on its own
and later phases only add layers. The numbering matches the pipeline stages in
[DESIGN.md §6](./DESIGN.md#6-generation-pipeline).

| Phase | Theme | Outcome | Est. |
|---|---|---|---|
| 0 | Foundation | Repo, CI, empty site deployed, engine skeleton | 1–2 wks |
| 1 | Terrain & rendering | Seeded terrain with water, contours, pan/zoom, URL sharing | 3–4 wks |
| 2 | Classic town | Parity with the reference's medieval town on top of terrain | 4–6 wks |
| 3 | Society & modern streets | Wealth/density fields and overlays, road hierarchy, grid districts, eras | 4–6 wks |
| 4 | Rail | Mainlines, stations, spurs, rail yards | 3–4 wks |
| 5 | Placement engine & facilities | Generic placement, ports, dry docks, industry, fill passes | 6–8 wks |
| 6 | Editing & export | Manual tools, undo, themes, PNG/SVG/PDF/GeoJSON/VTT | 4–5 wks |
| 7 | LLM assistant | Chat panel, tool use, BYOK, naming | 3–4 wks |
| 8 | Polish & ecosystem | Labels, POIs, custom features, MCP/CLI, docs, community | ongoing |

Total to a feature-complete v1 (through Phase 7): roughly **7–10 months** of
part-time effort, or 3–5 months with two people full-time.

---

## Phase 0 — Foundation

Goal: a green pipeline and an empty page at `https://<owner>.github.io/CityGenerator/`.

- [ ] Decide licence and framework (see OPEN-QUESTIONS Q1, Q8).
- [ ] pnpm monorepo: `apps/web`, `packages/core`, `packages/render`.
- [ ] Vite + React + TypeScript strict + ESLint + Prettier + Vitest + Playwright.
- [ ] GitHub Actions: `ci.yml` (lint, typecheck, test), `pages.yml` (build and
      deploy on `main`), preview builds on PRs as artifacts.
- [ ] `core`: seeded PRNG with named streams, `CitySpec` v1 schema (Zod → JSON
      Schema), stage runner with input hashing and memoisation, worker bridge.
- [ ] CONTRIBUTING.md with the clean-room policy; ADR folder.

Acceptance: a PR merging to `main` deploys; `pnpm test` runs a determinism test
(same seed → same hash) on Chromium, Firefox and WebKit.

## Phase 1 — Terrain and rendering

Goal: pick a preset and seed, see a landscape.

- [ ] Heightmap generation: fBm + domain warp + preset shape functions
      (plains, coast, bay, river valley, hills, island, delta).
- [ ] Hydrology: depression filling, flow accumulation, rivers, lakes, sea.
- [ ] Derived rasters: slope, aspect, distance-to-water, bathymetry.
- [ ] Contours (d3-contour) and hillshade.
- [ ] Scene model + Canvas renderer with pan/zoom, layers, culling.
- [ ] Parameter panel generated from the spec schema (Basics + Terrain groups).
- [ ] URL hash codec (lz-string), variations strip (6 seeds).
- [ ] Heightmap PNG import.

Acceptance: 4 × 4 km terrain in < 400 ms; contours and rivers render correctly
at all zooms; a shared URL reproduces the same terrain in another browser.

## Phase 2 — Classic town (reference parity on terrain)

Goal: a medieval/renaissance town that is at least as good as the reference,
but respecting water and slope.

- [ ] Site selection and buildable mask from terrain.
- [ ] Relaxed-Voronoi districts clipped to buildable land and split by rivers.
- [ ] Curtain wall, gates, citadel, plaza; walls follow terrain where sensible.
- [ ] Gate-to-plaza arteries and organic streets; bridges over rivers.
- [ ] Zone profiles for the reference's ward set; `rateLocation`-style scoring.
- [ ] Recursive lot subdivision and building footprints per profile.
- [ ] Farms, woods and gate wards as the first fill passes.
- [ ] `ink` theme; labels for district types.

Acceptance: golden-seed snapshot tests for 10 seeds × 3 presets; a reviewer
comparing against the reference finds no regressions in believability.

## Phase 3 — Society fields and modern streets

Goal: industrial and modern eras with visible wealth/density.

- [ ] Wealth and density rasters with the formulas in DESIGN §6.2; painted
      overrides.
- [ ] District classification (wealth × density classes) and overlays with
      legends; print-safe hatch variants.
- [ ] Road hierarchy: terrain-routed motorways/arterials, ring road, entry points.
- [ ] Street patterns: grid (jitter, diagonals), radial, cul-de-sac trees, mixed.
- [ ] Zone profiles for modern residential (all wealth × density combinations),
      CBD, retail strip, institutional; building kinds per class.
- [ ] Era selection and mixed-era layout (old core + modern periphery).
- [ ] Bridges, cuttings and tunnels on major roads; contour-aligned local streets.

Acceptance: toggling wealth/density overlays shows coherent gradients; the
"why is this here?" inspector explains zone choice; modern 6 × 6 km city in < 4 s.

## Phase 4 — Rail

- [ ] Rail graph type with gradient and curve-radius constraints.
- [ ] Mainlines from map edges, central station siting, secondary stations.
- [ ] Level crossings, rail bridges/underpasses over roads and water.
- [ ] Freight spurs and sidings to industrial districts.
- [ ] **Rail yard** feature: ladder tracks, throat geometry, depot, roundhouse
      (industrial era), intermodal cranes (modern).
- [ ] Rail rendering (parallel lines, sleepers at high zoom, station symbols).
- [ ] Rail noise as a nuisance input to the wealth field.

Acceptance: rail never exceeds the gradient cap on hill presets; yards align to
the mainline and connect at both ends; stats report km of track and stations.

## Phase 5 — Placement engine, ports and industry

- [ ] Placement engine: feature types, constraint/scorer primitives, Poisson
      candidate sampling, orientation, collision, degrade-and-report.
- [ ] Connector requests fulfilled by the local network stage (spur, quay road).
- [ ] **Container port**: quay/reclamation, berths, cranes, container yard,
      gate, breakwater, rail sidings, shipping approach lane.
- [ ] **Dry dock**: graving dock, gate, pump house, workshops; slipway variant.
- [ ] **Heavy industry**, **light industry/logistics**, **power plant**,
      **refinery**, **marina/fishing harbour**.
- [ ] Nuisance feedback into wealth field (second field pass).
- [ ] Fill passes: amenities, parks, parking/yards, woods/fields, trees, leftover
      reporting.
- [ ] Custom feature definitions (JSON) in the spec.

Acceptance: a `bay` preset in `modern` era produces a port with rail and road
access and industry behind it, with wealthy housing on the opposite shore, for
at least 8 of 10 seeds without manual edits; reported wasteland < 3 % of
buildable land.

## Phase 6 — Editing, themes and export

- [ ] Command bus, undo/redo, history thumbnails.
- [ ] Tools: terrain brush, field paint, place/drag/rotate/lock features,
      network hint lines, delete, regenerate-from-stage with pins kept.
- [ ] Inspector popover with constraint scores.
- [ ] Themes: parchment, blueprint, atlas, dark, print.
- [ ] Export: PNG (DPI, grid), SVG, tiled PDF, GeoJSON, Universal VTT, Foundry
      scene, `.city.json` save/load.
- [ ] Grid overlays, scale bar, compass, legend.

Acceptance: an edited map survives reload via URL or file; Playwright e2e for
each tool; exported SVG matches the Canvas view pixel-for-pixel at 1:1 in a
visual test.

## Phase 7 — LLM assistant

- [ ] Provider adapter interface; Anthropic adapter with the official SDK
      (streaming, adaptive thinking, refusal fallbacks), BYOK settings with cost
      display.
- [ ] Tool definitions generated from the command/query schemas
      (DESIGN §11.3), including `render_snapshot` for vision questions.
- [ ] Chat drawer with tool-call cards and inline undo; automatic
      `get_city_summary` at session start; context trimming.
- [ ] Naming tool on the cheaper model with structured output; label placement.
- [ ] Evaluation set: 30 scripted requests ("add a rail yard next to the port",
      "what is north of the cathedral?") with expected command outcomes, run in
      CI against recorded responses and periodically live.

Acceptance: all 30 eval requests produce valid commands; no tool can emit
geometry; a session with an invalid key fails with a clear message and no crash.

## Phase 8 — Polish and ecosystem (ongoing)

- POI layer (hospital, school, stadium, campus, prison, cemetery, military).
- Utility networks (power lines, pipelines, canals with locks).
- Growth timeline; condition layer (ruins, flooding).
- Isometric/3D view; player-facing export.
- `packages/mcp` MCP server and `citygen` CLI over the same commands.
- Culture/naming packs, localisation, PWA, gallery, plugin registry.
- Documentation site (user guide, feature-authoring guide, architecture).

---

## Milestone tags

- `v0.1` — end of Phase 1 (terrain playground)
- `v0.2` — end of Phase 2 (medieval towns)
- `v0.3` — end of Phase 3 (modern cities with wealth/density)
- `v0.5` — end of Phase 5 (ports, rail, industry)
- `v0.8` — end of Phase 6 (editing and export)
- `v1.0` — end of Phase 7 (assistant) plus a tuning pass over all presets
