import * as Comlink from 'comlink';
import {
  StageRunner,
  computeFixtureHash,
  landcoverStage,
  regionOutlineStage,
  roadsStage,
  sitingStage,
  societyStage,
  terrainStage,
  townStage,
  LANDCOVER,
  pointInRing,
  type LandcoverOutput,
  type MapDocument,
  type SitingOutput,
  type SocietyOutput,
  type TerrainInput,
  type TerrainOutput,
  type TownOutput,
} from '@citygen/core';
import { biomeTerrain, eraForYear, eraParams } from '@citygen/features';
import {
  BlockTiler,
  TileSource,
  createDemSampler,
  demTilePng,
  renderThumbnail,
  settlementLayers,
  societyLayers,
  terrainLayers,
  type DemSampler,
} from '@citygen/tiles';
import type { EngineApi, EngineStats, Thumbnail } from './api.js';

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
} | null = null;

function terrainInput(doc: MapDocument, cellSizeM?: number): TerrainInput {
  const t = doc.spec.terrain;
  return {
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

    // Settlements: siting, one town stage per site, then roads between them.
    const t3 = performance.now();
    const siting = await runner.run(
      sitingStage,
      {
        seed: doc.spec.seed,
        terrain,
        year: doc.spec.year,
        settlements: doc.spec.settlements,
        policy: doc.spec.settlementPolicy,
      },
      { signal },
    );
    const era = eraForYear(doc.spec.year);
    const society = await runner.run(
      societyStage,
      {
        seed: doc.spec.seed,
        terrain,
        sites: siting.sites,
        year: doc.spec.year,
        wealth: doc.spec.society.wealth,
        density: doc.spec.society.density,
        inequality: doc.spec.society.inequality,
      },
      { signal },
    );
    const eras = eraParams();
    const towns: TownOutput[] = [];
    for (const site of siting.sites) {
      const blockSizeM = site.spec.layout.blockSizeM ?? era.blockSizeM.core;
      towns.push(
        await runner.run(
          townStage,
          { seed: doc.spec.seed, site, terrain, year: doc.spec.year, blockSizeM, eras, society },
          { signal },
        ),
      );
    }
    const settlementsMs = performance.now() - t3;
    const t4 = performance.now();
    const roads = await runner.run(
      roadsStage,
      { seed: doc.spec.seed, terrain, sites: siting.sites },
      { signal },
    );
    const roadsMs = performance.now() - t4;

    const t2 = performance.now();
    version += 1;
    const blocks = towns.flatMap((t) => t.blocks);
    source = new TileSource(
      [
        { name: 'region', features: { type: 'FeatureCollection', features: [outline.boundary] } },
        { name: 'graticule', features: outline.graticule, minZoom: 9 },
        ...terrainLayers(terrain, landcover, options.sketch ? { sketch: { seed: doc.spec.seed } } : {}),
        ...settlementLayers(towns, roads, siting),
        ...societyLayers(society),
        { name: 'authored', features: doc.authored },
      ],
      version,
      [new BlockTiler(blocks, doc.spec.year, { minZoom: 13 })],
    );
    latest = { terrain, landcover, society, siting, towns };
    dem = { sampler: createDemSampler(terrain, doc.spec.seed), extent: doc.spec.extent };
    const tilesMs = performance.now() - t2;

    const stats: EngineStats = {
      terrainMs,
      landcoverMs,
      settlementsMs,
      roadsMs,
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
      blocks: blocks.length,
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
    return {
      x,
      y,
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
};

Comlink.expose(api);
