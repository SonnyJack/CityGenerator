import * as Comlink from 'comlink';
import {
  StageRunner,
  computeFixtureHash,
  landcoverStage,
  regionOutlineStage,
  roadsStage,
  sitingStage,
  societyStage,
  railStage,
  tramStage,
  facilitiesStage,
  pointInRing as inRing,
  distToRing,
  type FacilitiesOutput,
  terrainStage,
  townStage,
  LANDCOVER,
  pointInRing,
  distToPolyline,
  fieldEdits,
  reseedSalt,
  terrainEdits,
  zoneEdits,
  type LandcoverOutput,
  type MapDocument,
  type SitingOutput,
  type SocietyOutput,
  type TerrainInput,
  type TerrainOutput,
  type TownOutput,
  type TramOutput,
} from '@citygen/core';
import { biomeTerrain, eraForYear, eraParams } from '@citygen/features';
import {
  BlockTiler,
  TileSource,
  createDemSampler,
  demTilePng,
  renderThumbnail,
  railLayers,
  facilityLayers,
  settlementLayers,
  societyLayers,
  terrainLayers,
  type DemSampler,
} from '@citygen/tiles';
import type { EngineApi, EngineStats, GeneratedHit, Thumbnail } from './api.js';

/**
 * Engine worker: runs pipeline stages off the UI thread and serves vector and
 * DEM tiles to MapLibre. One StageRunner lives for the worker's lifetime so
 * unchanged stages are served from memo across document edits.
 */

const runner = new StageRunner({ maxEntries: 64 });
let version = 0;
let source: TileSource | null = null;
let dem: { sampler: DemSampler; extent: { widthM: number; heightM: number } } | null = null;
let controller: AbortController | null = null;
/** Latest results kept for inspection queries. */
let latest: {
  terrain: TerrainOutput;
  landcover: LandcoverOutput;
  society: SocietyOutput;
  siting: SitingOutput;
  towns: TownOutput[];
  tiler: BlockTiler;
  facilities: FacilitiesOutput;
} | null = null;

function terrainInput(doc: MapDocument, cellSizeM?: number): TerrainInput {
  const t = doc.spec.terrain;
  const edits = terrainEdits(doc);
  return {
    ...(edits.length ? { edits } : {}),
    seed: doc.spec.seed,
    extent: doc.spec.extent,
    preset: t.preset,
    relief: t.relief,
    roughness: t.roughness,
    seaLevel: t.seaLevel,
    erosion: t.erosion,
    rivers: t.rivers,
    biome: biomeTerrain(doc.spec.biome),
    ...(cellSizeM ? { cellSizeM } : {}),
  };
}

const api: EngineApi = {
  async setDocument(doc, options) {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const started = performance.now();

    const t0 = performance.now();
    const terrain: TerrainOutput = await runner.run(terrainStage, terrainInput(doc), { signal });
    const terrainMs = performance.now() - t0;

    const t1 = performance.now();
    const landcover = await runner.run(
      landcoverStage,
      { terrain, biome: biomeTerrain(doc.spec.biome), seed: doc.spec.seed },
      { signal },
    );
    const landcoverMs = performance.now() - t1;

    const outline = await runner.run(
      regionOutlineStage,
      { seed: doc.spec.seed, extent: doc.spec.extent },
      { signal },
    );

    // Settlements: siting, one town stage per site, then roads between them. A
    // region-wide reseed salts everything downstream of terrain; a settlement
    // reseed salts only that town.
    const regionSalt = reseedSalt(doc.overrides, 'region');
    const seed = regionSalt ? `${doc.spec.seed}/${regionSalt}` : doc.spec.seed;
    const t3 = performance.now();
    const siting = await runner.run(
      sitingStage,
      {
        seed,
        terrain,
        year: doc.spec.year,
        settlements: doc.spec.settlements,
        policy: doc.spec.settlementPolicy,
      },
      { signal },
    );
    const era = eraForYear(doc.spec.year);
    const eras = eraParams();
    // Rail before society: the lines and yards are noise sources for the wealth field.
    const t5 = performance.now();
    const rail = await runner.run(
      railStage,
      {
        seed,
        terrain,
        sites: siting.sites,
        year: doc.spec.year,
        eras,
        mainlines: doc.spec.networks.rail.mainlines,
        enabled: doc.spec.networks.rail.enabled,
      },
      { signal },
    );
    let railMs = performance.now() - t5;
    // Facilities: ports, industry, institutions and airports, placed before society
    // (they are nuisance sources) and before the towns (which reserve their land).
    const t7 = performance.now();
    const facilities = await runner.run(
      facilitiesStage,
      {
        seed,
        terrain,
        sites: siting.sites,
        rail,
        year: doc.spec.year,
        extent: doc.spec.extent,
        requests: [
          ...doc.spec.features.map((f) => ({
            id: f.id,
            type: f.type,
            size: f.size ?? 'medium',
            ...(f.pin ? { pin: f.pin } : {}),
            ...(f.params ? { params: f.params } : {}),
          })),
          ...doc.spec.settlements.flatMap((st) =>
            st.features.map((f) => ({
              id: f.id.includes(':') ? f.id : `${st.id}:${f.id}`,
              type: f.type,
              size: f.size ?? 'medium',
              settlement: st.id,
              ...(f.pin ? { pin: f.pin } : {}),
              ...(f.params ? { params: f.params } : {}),
            })),
          ),
        ],
        removed: doc.overrides.flatMap((o) => (o.op === 'remove' ? [o.target] : [])),
        pins: doc.overrides.flatMap((o) =>
          o.op === 'pin' ? [{ target: o.target, x: o.x, y: o.y, rotation: o.rotation }] : [],
        ),
        customTypes: doc.spec.customFeatureTypes,
        scaleCompression: doc.spec.scaleCompression,
        defaults: doc.spec.defaultFacilities,
      },
      { signal },
    );
    const facilitiesMs = performance.now() - t7;
    const edits = fieldEdits(doc);
    const society = await runner.run(
      societyStage,
      {
        seed,
        terrain,
        sites: siting.sites,
        year: doc.spec.year,
        wealth: doc.spec.society.wealth,
        density: doc.spec.society.density,
        inequality: doc.spec.society.inequality,
        ...(edits.length ? { edits } : {}),
        ...(rail.nuisance.length || facilities.nuisance.length
          ? { nuisance: [...rail.nuisance, ...facilities.nuisance] }
          : {}),
      },
      { signal },
    );
    // Rail yards and facilities take town land.
    const reserved = [
      ...facilities.reserved,
      ...rail.structures.features
        .filter((f) => f.properties.kind === 'railYard' || f.properties.kind === 'goodsYard')
        .map((f) => ({
          id: f.properties.kind,
          ring: f.geometry.coordinates[0]!.map((p) => [p[0]!, p[1]!] as [number, number]),
          ward: 'yard' as const,
        })),
    ];
    const zones = zoneEdits(doc);
    const towns: TownOutput[] = [];
    for (const site of siting.sites) {
      const blockSizeM = site.spec.layout.blockSizeM ?? era.blockSizeM.core;
      // Settlement salts exclude the region salt, which is already in `seed`.
      const salt = reseedSalt(
        doc.overrides.filter((o) => o.op !== 'reseed' || o.target !== 'region'),
        site.id,
      );
      towns.push(
        await runner.run(
          townStage,
          {
            seed,
            site,
            terrain,
            year: doc.spec.year,
            blockSizeM,
            eras,
            society,
            ...(salt ? { salt } : {}),
            ...(zones.length ? { zoneEdits: zones } : {}),
            ...(reserved.length ? { reserved } : {}),
          },
          { signal },
        ),
      );
    }
    const settlementsMs = performance.now() - t3;
    const t4 = performance.now();
    const roads = await runner.run(roadsStage, { seed, terrain, sites: siting.sites }, { signal });
    const roadsMs = performance.now() - t4;
    // Trams and crossings per town, after the streets exist.
    const t6 = performance.now();
    const trams: TramOutput[] = [];
    for (let i = 0; i < towns.length; i++) {
      trams.push(
        await runner.run(
          tramStage,
          {
            seed,
            site: siting.sites[i]!,
            town: towns[i]!,
            year: doc.spec.year,
            eras,
            rail,
            enabled: doc.spec.networks.rail.enabled,
          },
          { signal },
        ),
      );
    }
    railMs += performance.now() - t6;

    const t2 = performance.now();
    version += 1;
    const blocks = towns.flatMap((t) => t.blocks);
    // Authored geometry wins over generated buildings; overrides hide or re-roll them.
    const tiler = new BlockTiler(blocks, doc.spec.year, {
      minZoom: 13,
      authored: doc.authored.features.filter((f) =>
        ['building', 'zone', 'facility', 'street', 'rail', 'tram', 'water', 'vegetation'].includes(
          f.properties.layer,
        ),
      ),
      suppressIds: doc.overrides.flatMap((o) => (o.op === 'suppress' || o.op === 'remove' ? [o.target] : [])),
      rerolls: doc.overrides.flatMap((o) =>
        o.op === 'reroll'
          ? [{ polygon: o.polygon.map((p) => [p[0]!, p[1]!] as [number, number]), salt: o.salt }]
          : [],
      ),
    });
    source = new TileSource(
      [
        { name: 'region', features: { type: 'FeatureCollection', features: [outline.boundary] } },
        { name: 'graticule', features: outline.graticule, minZoom: 9 },
        ...terrainLayers(terrain, landcover, options.sketch ? { sketch: { seed: doc.spec.seed } } : {}),
        ...settlementLayers(towns, roads, siting),
        ...facilityLayers(facilities),
        ...railLayers(rail, trams, roads, facilities.spurs),
        ...societyLayers(society),
      ],
      version,
      [tiler],
    );
    latest = { terrain, landcover, society, siting, towns, tiler, facilities };
    const wasteland = measureWasteland(terrain, siting, towns, facilities, rail);
    dem = { sampler: createDemSampler(terrain, doc.spec.seed), extent: doc.spec.extent };
    const tilesMs = performance.now() - t2;

    const stats: EngineStats = {
      terrainMs,
      landcoverMs,
      settlementsMs,
      roadsMs: roadsMs + railMs + facilitiesMs,
      tilesMs,
      totalMs: performance.now() - started,
      memoHits: runner.hits,
      memoMisses: runner.misses,
      terrain: { ...terrain.stats, contourIntervalM: terrain.contourIntervalM },
      settlements: towns.map((t, i) => ({
        id: t.id,
        kind: siting.sites[i]!.kind,
        name: siting.sites[i]!.name,
        population: siting.sites[i]!.population,
        center: siting.sites[i]!.center,
        radiusM: t.radiusM,
        patches: t.stats.patches,
        walled: t.stats.walled,
        blocks: t.blocks.length,
        rings: t.stats.rings,
        coreRadiusM: t.stats.coreRadiusM,
      })),
      era: { id: era.id, name: era.name, year: era.year },
      roads: roads.stats,
      rail: {
        trackKm: rail.stats.trackKm,
        mainlineKm: rail.stats.mainlineKm,
        stations: rail.stats.stations,
        yards: rail.stats.yards,
        tunnels: rail.stats.tunnels,
        viaducts: rail.stats.viaducts,
        maxGradient: rail.stats.maxGradient,
        disusedKm: rail.stats.disusedKm,
        tramKm: trams.reduce((a, t) => a + t.stats.tramKm, 0),
        tramLines: trams.reduce((a, t) => a + t.stats.lines, 0),
        crossings: trams.reduce((a, t) => a + t.stats.crossings, 0),
      },
      blocks: blocks.length,
      facilities: {
        placed: facilities.stats.placed,
        failed: facilities.stats.failed,
        byCategory: facilities.stats.byCategory,
        list: facilities.features.features.map((f) => ({
          id: f.properties.id,
          type: f.properties.type,
          name: f.properties.name,
          settlement: f.properties.settlement,
          pinned: f.properties.pinned,
          outcome: f.properties.outcome,
          center: centroidOf(f.geometry.coordinates[0]!),
          rotation: f.properties.rotation,
        })),
        failures: facilities.failures,
        wasteland,
      },
    };
    return { version, stats };
  },

  async getTile(v, z, x, y) {
    if (!source || v !== source.version) return null;
    const data = source.getTile(z, x, y);
    if (!data) return null;
    return Comlink.transfer(data, [data.buffer as ArrayBuffer]);
  },

  async getDemTile(v, z, x, y) {
    if (!dem || !source || v !== source.version) return null;
    const png = await demTilePng(dem.sampler, dem.extent, z, x, y, 256);
    if (!png) return null;
    return Comlink.transfer(png, [png.buffer as ArrayBuffer]);
  },

  async thumbnails(doc, seeds, width, height) {
    const out: Thumbnail[] = [];
    // Coarse cells keep previews cheap: ~96 cells on the long side.
    const cellSizeM = Math.max(
      20,
      Math.ceil(Math.max(doc.spec.extent.widthM, doc.spec.extent.heightM) / 96 / 5) * 5,
    );
    for (const seed of seeds) {
      const terrain = await runner.run(terrainStage, { ...terrainInput(doc, cellSizeM), seed });
      out.push({ seed, width, height, rgba: renderThumbnail(terrain, width, height) });
    }
    return out;
  },

  fixtureHash: () => computeFixtureHash(),

  async inspect(x, y) {
    if (!latest) return null;
    const { terrain, landcover, society, siting, towns } = latest;
    const { height } = terrain;
    const col = Math.min(Math.max(Math.round(height.col(x)), 0), height.width - 1);
    const row = Math.min(Math.max(Math.round(height.row(y)), 0), height.height - 1);
    const i = row * height.width + col;
    const waterNames = ['land', 'sea', 'lake', 'river'] as const;
    const lcCol = Math.min(
      Math.max(Math.round((x - landcover.raster.originX) / landcover.raster.cellSizeM), 0),
      landcover.raster.width - 1,
    );
    const lcRow = Math.min(
      Math.max(Math.round((y - landcover.raster.originY) / landcover.raster.cellSizeM), 0),
      landcover.raster.height - 1,
    );
    const lcClass = landcover.classes[lcRow * landcover.raster.width + lcCol]!;
    const lcName =
      (Object.keys(LANDCOVER) as (keyof typeof LANDCOVER)[]).find((k) => LANDCOVER[k] === lcClass) ?? 'open';
    const f = society.sample(x, y);
    let settlement: NonNullable<Awaited<ReturnType<EngineApi['inspect']>>>['settlement'];
    let patch: NonNullable<Awaited<ReturnType<EngineApi['inspect']>>>['patch'];
    for (let t = 0; t < towns.length; t++) {
      const town = towns[t]!;
      if (Math.hypot(x - town.center[0], y - town.center[1]) > town.radiusM * 2) continue;
      for (const p of town.patches.features) {
        const ring = p.geometry.coordinates[0]!.map((c) => [c[0]!, c[1]!] as [number, number]);
        if (pointInRing(x, y, ring)) {
          const site = siting.sites[t]!;
          settlement = { id: site.id, kind: site.kind, name: site.name, population: site.population };
          patch = {
            ward: p.properties.ward,
            inner: p.properties.inner,
            ring: p.properties.ring,
            why: p.properties.why,
          };
          break;
        }
      }
      if (patch) break;
    }
    let facility: NonNullable<Awaited<ReturnType<EngineApi['inspect']>>>['facility'];
    for (const f of latest.facilities.features.features) {
      const ring = f.geometry.coordinates[0]!.map((c) => [c[0]!, c[1]!] as [number, number]);
      if (!inRing(x, y, ring)) continue;
      const part = latest.facilities.parts.features.find(
        (p) =>
          p.properties.feature === f.properties.id &&
          p.geometry.type === 'Polygon' &&
          inRing(
            x,
            y,
            p.geometry.coordinates[0]!.map((c) => [c[0]!, c[1]!] as [number, number]),
          ),
      );
      facility = {
        id: f.properties.id,
        type: f.properties.type,
        name: f.properties.name,
        settlement: f.properties.settlement,
        lengthM: f.properties.lengthM,
        widthM: f.properties.widthM,
        realLengthM: f.properties.realLengthM,
        realWidthM: f.properties.realWidthM,
        pinned: f.properties.pinned,
        outcome: f.properties.outcome,
        center: centroidOf(f.geometry.coordinates[0]!),
        rotation: f.properties.rotation,
        ...(part
          ? {
              part: {
                kind: part.properties.kind,
                ...(part.properties.name ? { name: part.properties.name } : {}),
              },
            }
          : {}),
      };
      break;
    }
    return {
      x,
      y,
      facility,
      elevationM: height.data[i]!,
      slope: terrain.slope[i]!,
      water: waterNames[terrain.water[i]!] ?? 'land',
      landcover: lcName,
      wealth: f.wealth,
      density: f.density,
      wealthClass: f.wealthClass,
      densityClass: f.densityClass,
      settlement,
      patch,
    };
  },

  async generatedAt(x, y, toleranceM) {
    if (!latest) return null;
    const { towns, tiler } = latest;
    const asHit = (
      layer: GeneratedHit['layer'],
      f: { id?: string | number; geometry: GeneratedHit['geometry']; properties: unknown },
    ): GeneratedHit => ({
      layer,
      id: String(f.id),
      geometry: f.geometry,
      properties: (f.properties ?? {}) as Record<string, unknown>,
    });
    for (const town of towns) {
      if (Math.hypot(x - town.center[0], y - town.center[1]) > town.radiusM * 2) continue;
      // Buildings first (smallest), then streets, then the patch.
      for (const block of town.blocks) {
        if (!pointInRing(x, y, block.ring)) continue;
        for (const b of tiler.model(block).buildings) {
          const ring = b.geometry.coordinates[0]!.map((c) => [c[0]!, c[1]!] as [number, number]);
          if (pointInRing(x, y, ring)) return asHit('buildings', b);
        }
      }
      for (const st of town.streets.features) {
        const pts = st.geometry.coordinates.map((c) => [c[0]!, c[1]!] as [number, number]);
        const w = st.properties.class === 'artery' ? 10 : 6;
        if (distToPolyline(x, y, pts) <= Math.max(toleranceM, w / 2)) return asHit('streets', st);
      }
      for (const p of town.patches.features) {
        const ring = p.geometry.coordinates[0]!.map((c) => [c[0]!, c[1]!] as [number, number]);
        if (pointInRing(x, y, ring)) return asHit('patches', p);
      }
    }
    return null;
  },
};

function centroidOf(ring: number[][]): [number, number] {
  const n = ring.length - 1 || 1;
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    x += ring[i]![0]!;
    y += ring[i]![1]!;
  }
  return [x / n, y / n];
}

/**
 * Wasteland: buildable land inside each settlement's built-up radius that no
 * patch, facility or yard uses, as a fraction of the buildable land there.
 */
function measureWasteland(
  terrain: TerrainOutput,
  siting: SitingOutput,
  towns: TownOutput[],
  facilities: FacilitiesOutput,
  rail: { structures: { features: { geometry: { coordinates: number[][][] } }[] } },
): EngineStats['facilities']['wasteland'] {
  const { height, water, slope } = terrain;
  const bySettlement: Record<string, number> = {};
  let usedAll = 0;
  let buildableAll = 0;
  const rings = (fc: { features: { geometry: { coordinates: number[][][] } }[] }) =>
    fc.features.map((f) => f.geometry.coordinates[0]!.map((c) => [c[0]!, c[1]!] as [number, number]));
  const facilityRings = rings(facilities.features);
  const yardRings = rings(rail.structures);
  towns.forEach((town, i) => {
    const site = siting.sites[i]!;
    const R = site.radiusM;
    const patchRings = rings(town.patches);
    const step = Math.max(30, R / 25);
    let buildable = 0;
    let used = 0;
    for (let y = site.center[1] - R; y <= site.center[1] + R; y += step)
      for (let x = site.center[0] - R; x <= site.center[0] + R; x += step) {
        if (Math.hypot(x - site.center[0], y - site.center[1]) > R) continue;
        const col = Math.min(Math.max(Math.round(height.col(x)), 0), height.width - 1);
        const row = Math.min(Math.max(Math.round(height.row(y)), 0), height.height - 1);
        const k = row * height.width + col;
        if (water[k] !== 0 || slope[k]! > 0.3) continue;
        buildable++;
        // Streets between blocks are used land too: anything within 25 m of a patch counts.
        const near = (r: [number, number][]) => inRing(x, y, r) || distToRing([x, y], r) <= 25;
        if (patchRings.some(near) || facilityRings.some(near) || yardRings.some(near)) used++;
      }
    bySettlement[site.id] = buildable ? 1 - used / buildable : 0;
    usedAll += used;
    buildableAll += buildable;
  });
  return { overall: buildableAll ? 1 - usedAll / buildableAll : 0, bySettlement };
}

Comlink.expose(api);
