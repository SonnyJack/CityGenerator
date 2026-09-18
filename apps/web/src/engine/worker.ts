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
  regionNamesStage,
  townNamesStage,
  StreetIndex,
  culturePack,
  pointInRing as inRing,
  type TownNamesOutput,
  type BuildingProps,
  type RailOutput,
  type RoadsOutput,
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
import type { DirectoryEntry, EngineApi, EngineStats, GeneratedHit, Thumbnail } from './api.js';
import type { ExportModel } from '@citygen/export';
import type { Feature, Geometry, LineString, Point, Polygon } from 'geojson';

/**
 * Engine worker: runs pipeline stages off the UI thread and serves vector and
 * DEM tiles to MapLibre. One StageRunner lives for the worker's lifetime so
 * unchanged stages are served from memo across document edits.
 */

const runner = new StageRunner({ maxEntries: 64 });
let currentDoc: MapDocument | null = null;
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
  townNames: TownNamesOutput[];
  rail: RailOutput | null;
  roads: RoadsOutput | null;
  trams: TramOutput[];
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
    currentDoc = doc;
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
    const eras = eraParams(doc.spec.culture);
    // Names for settlements and rivers come first so every later stage sees named sites.
    const regionNames = await runner.run(
      regionNamesStage,
      {
        seed: doc.spec.seed,
        culture: doc.spec.culture,
        ...(doc.spec.cultureMix
          ? { cultureMix: doc.spec.cultureMix.map((m) => ({ culture: m.culture, weight: m.weight })) }
          : {}),
        year: doc.spec.year,
        sites: siting.sites,
        rivers: terrain.riverLines.features.filter((r) => r.properties.order >= 2).map((r) => String(r.id)),
      },
      { signal },
    );
    const sites = siting.sites.map((s) => (s.name ? s : { ...s, name: regionNames.siteNames[s.id] }));
    const namedSiting = { ...siting, sites };
    // Rail before society: the lines and yards are noise sources for the wealth field.
    const t5 = performance.now();
    const rail = await runner.run(
      railStage,
      {
        seed,
        terrain,
        sites,
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
        sites,
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
        sites,
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
    for (const site of sites) {
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
    const roads = await runner.run(roadsStage, { seed, terrain, sites }, { signal });
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
            site: sites[i]!,
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
    // Street and district names per town, then a street index for addresses.
    const t8 = performance.now();
    const townNames: TownNamesOutput[] = [];
    for (let i = 0; i < towns.length; i++) {
      townNames.push(
        await runner.run(
          townNamesStage,
          {
            seed: doc.spec.seed,
            culture: doc.spec.culture,
            ...(doc.spec.cultureMix
              ? { cultureMix: doc.spec.cultureMix.map((m) => ({ culture: m.culture, weight: m.weight })) }
              : {}),
            year: doc.spec.year,
            site: sites[i]!,
            town: towns[i]!,
            facilities: facilities.features.features
              .filter((f) => f.properties.settlement === sites[i]!.id)
              .map((f) => ({
                id: f.properties.id,
                type: f.properties.type,
                center: centroidOf(f.geometry.coordinates[0]!),
              })),
          },
          { signal },
        ),
      );
    }
    const streetIndex = new StreetIndex(townNames.map((t) => t.ways));
    const namesMs = performance.now() - t8;

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
      block: {
        pack: culturePack(doc.spec.culture),
        address: (x, y) => streetIndex.address(x, y),
        ...(doc.spec.cultureMix
          ? { cultureMix: doc.spec.cultureMix.map((m) => ({ culture: m.culture, weight: m.weight })) }
          : {}),
      },
    });
    source = new TileSource(
      [
        { name: 'region', features: { type: 'FeatureCollection', features: [outline.boundary] } },
        { name: 'graticule', features: outline.graticule, minZoom: 9 },
        ...terrainLayers(terrain, landcover, {
          ...(options.sketch ? { sketch: { seed: doc.spec.seed } } : {}),
          riverNames: regionNames.riverNames,
        }),
        ...settlementLayers(towns, roads, namedSiting, {
          towns: townNames,
          siteNames: regionNames.siteNames,
        }),
        ...facilityLayers(facilities),
        ...railLayers(rail, trams, roads, facilities.spurs),
        ...societyLayers(society),
      ],
      version,
      [tiler],
    );
    latest = {
      terrain,
      landcover,
      society,
      siting: namedSiting,
      towns,
      tiler,
      facilities,
      townNames,
      rail,
      roads,
      trams,
    };
    const wasteland = measureWasteland(terrain, namedSiting, towns, facilities, rail);
    dem = { sampler: createDemSampler(terrain, doc.spec.seed), extent: doc.spec.extent };
    const tilesMs = performance.now() - t2;

    const stats: EngineStats = {
      terrainMs,
      landcoverMs,
      settlementsMs,
      roadsMs: roadsMs + railMs + facilitiesMs + namesMs,
      tilesMs,
      totalMs: performance.now() - started,
      memoHits: runner.hits,
      memoMisses: runner.misses,
      terrain: { ...terrain.stats, contourIntervalM: terrain.contourIntervalM },
      regionName: regionNames.regionName,
      culture: doc.spec.culture,
      settlements: towns.map((t, i) => ({
        id: t.id,
        kind: sites[i]!.kind,
        name: sites[i]!.name,
        population: sites[i]!.population,
        center: sites[i]!.center,
        radiusM: t.radiusM,
        patches: t.stats.patches,
        walled: t.stats.walled,
        blocks: t.blocks.length,
        rings: t.stats.rings,
        coreRadiusM: t.stats.coreRadiusM,
        ways: townNames[i]?.stats.ways ?? 0,
        districts: townNames[i]?.stats.districts ?? 0,
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
            district: latest.townNames[t]?.patchDistricts[String(p.id)],
          };
          break;
        }
      }
      if (patch) break;
    }
    let building: NonNullable<Awaited<ReturnType<EngineApi['inspect']>>>['building'];
    for (const town of towns) {
      if (Math.hypot(x - town.center[0], y - town.center[1]) > town.radiusM * 2) continue;
      for (const block of town.blocks) {
        if (!pointInRing(x, y, block.ring)) continue;
        for (const b of latest.tiler.model(block).buildings) {
          const ring = b.geometry.coordinates[0]!.map((c) => [c[0]!, c[1]!] as [number, number]);
          if (pointInRing(x, y, ring)) {
            building = buildingSummary(b.properties, String(b.id));
            break;
          }
        }
        if (building) break;
      }
      if (building) break;
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
      building,
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

  async exportFrame(frame) {
    const empty = <G extends Geometry>() => ({
      type: 'FeatureCollection' as const,
      features: [] as Feature<G, Record<string, unknown>>[],
    });
    if (!latest || !currentDoc) {
      const e = empty();
      return {
        frame,
        year: 0,
        name: '',
        water: e,
        rivers: e,
        landcover: e,
        contours: e,
        patches: e,
        streets: e,
        ways: e,
        walls: e,
        roads: e,
        rail: e,
        stations: e,
        railStructures: e,
        facilities: e,
        facilityParts: e,
        buildings: e,
        blocks: e,
        districts: e,
        authored: e,
        annotations: e,
      } as unknown as ExportModel;
    }
    const { terrain, landcover, towns, tiler, facilities, townNames, siting } = latest;
    const doc = currentDoc;
    const touches = (ring: [number, number][]) =>
      ring.some(([x, y]) => x >= frame.minX && x <= frame.maxX && y >= frame.minY && y <= frame.maxY) ||
      ring.length === 0;
    const buildings: Feature<Polygon, Record<string, unknown>>[] = [];
    const blocks: Feature<Polygon, Record<string, unknown>>[] = [];
    for (const town of towns) {
      for (const block of town.blocks) {
        const bb = block.ring.reduce(
          (a, [x, y]) => ({
            minX: Math.min(a.minX, x),
            minY: Math.min(a.minY, y),
            maxX: Math.max(a.maxX, x),
            maxY: Math.max(a.maxY, y),
          }),
          { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
        );
        if (bb.minX > frame.maxX || bb.maxX < frame.minX || bb.minY > frame.maxY || bb.maxY < frame.minY)
          continue;
        blocks.push({
          type: 'Feature',
          id: block.id,
          geometry: { type: 'Polygon', coordinates: [[...block.ring, block.ring[0]!]] },
          properties: { ward: block.ward, settlement: block.settlementId },
        });
        for (const b of tiler.model(block).buildings)
          buildings.push(b as unknown as Feature<Polygon, Record<string, unknown>>);
      }
    }
    void touches;
    const fc = <G extends Geometry>(features: Feature<G, Record<string, unknown>>[]) => ({
      type: 'FeatureCollection' as const,
      features,
    });
    const any = (x: unknown) => x as Feature<Geometry, Record<string, unknown>>[];
    return {
      frame,
      year: doc.spec.year,
      name: doc.meta.name,
      water: fc([...terrain.seaPolygons.features, ...terrain.lakePolygons.features] as unknown as Feature<
        Polygon,
        Record<string, unknown>
      >[]),
      rivers: fc(
        terrain.riverLines.features.map((r) => ({
          ...r,
          properties: { ...r.properties, name: (latest?.townNames && undefined) ?? undefined },
        })) as unknown as Feature<LineString, Record<string, unknown>>[],
      ),
      landcover: fc(
        (landcover.polygons?.features ?? []) as unknown as Feature<Polygon, Record<string, unknown>>[],
      ),
      contours: fc(terrain.contours.features as unknown as Feature<LineString, Record<string, unknown>>[]),
      patches: fc(
        towns.flatMap((t, i) =>
          t.patches.features.map((p) => ({
            ...p,
            properties: { ...p.properties, district: townNames[i]?.patchDistricts[String(p.id)] },
          })),
        ) as unknown as Feature<Polygon, Record<string, unknown>>[],
      ),
      streets: fc(
        towns.flatMap((t, i) =>
          t.streets.features.map((st) => ({
            ...st,
            properties: { ...st.properties, name: townNames[i]?.streetNames[String(st.id)] },
          })),
        ) as unknown as Feature<LineString, Record<string, unknown>>[],
      ),
      ways: fc(
        townNames.flatMap((t) => t.ways.features) as unknown as Feature<
          LineString,
          Record<string, unknown>
        >[],
      ),
      walls: fc(
        towns.flatMap((t) => t.walls.features) as unknown as Feature<LineString, Record<string, unknown>>[],
      ),
      roads: fc([...(latest.roads?.roads.features ?? []), ...facilities.roads.features] as unknown as Feature<
        LineString,
        Record<string, unknown>
      >[]),
      rail: fc([
        ...(latest.rail?.tracks.features ?? []),
        ...facilities.spurs.features,
        ...(latest.trams ?? []).flatMap((t) => t.lines.features),
      ] as unknown as Feature<LineString, Record<string, unknown>>[]),
      stations: fc([
        ...(latest.rail?.stations.features ?? []),
        ...(latest.trams ?? []).flatMap((t) => t.stops.features),
      ] as unknown as Feature<Point, Record<string, unknown>>[]),
      railStructures: fc([
        ...(latest.rail?.structures.features ?? []),
        ...(latest.trams ?? []).flatMap((t) => t.structures.features),
      ] as unknown as Feature<Polygon, Record<string, unknown>>[]),
      facilities: fc(facilities.features.features as unknown as Feature<Polygon, Record<string, unknown>>[]),
      facilityParts: fc(any(facilities.parts.features)),
      buildings: fc(buildings),
      blocks: fc(blocks),
      districts: fc(
        townNames.flatMap((t) => t.districts.features) as unknown as Feature<
          Point,
          Record<string, unknown>
        >[],
      ),
      authored: fc(any(doc.authored.features)),
      annotations: fc(
        doc.annotations.map((a) => ({
          type: 'Feature' as const,
          id: a.id,
          geometry: a.geometry as Geometry,
          properties: { kind: a.kind, text: a.text, gmOnly: a.gmOnly },
        })),
      ),
      settlements: siting.sites.map((s) => ({ id: s.id, name: s.name })),
    } as unknown as ExportModel;
  },

  async directory(settlement, query, limit) {
    if (!latest) return { total: 0, entries: [] };
    const { towns, tiler } = latest;
    const q = query.trim().toLowerCase();
    const entries: DirectoryEntry[] = [];
    let total = 0;
    for (const town of towns) {
      if (settlement && town.id !== settlement) continue;
      for (const block of town.blocks) {
        for (const b of tiler.model(block).buildings) {
          const e = buildingSummary(b.properties, String(b.id));
          if (q && !`${e.name} ${e.useLabel} ${e.address ?? ''} ${e.kindLabel}`.toLowerCase().includes(q))
            continue;
          total++;
          if (entries.length < limit) {
            const ring = b.geometry.coordinates[0]!;
            entries.push({ ...e, settlement: town.id, center: centroidOf(ring) });
          }
        }
      }
    }
    return { total, entries };
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

function buildingSummary(p: BuildingProps, id: string): Omit<DirectoryEntry, 'settlement' | 'center'> {
  return {
    id,
    name: p.name ?? '',
    use: p.use ?? 'residential',
    useLabel: p.useLabel ?? 'residence',
    kind: p.kind,
    kindLabel: p.kindLabel ?? p.kind,
    material: p.material ?? '',
    floors: p.floors,
    ward: p.ward,
    ...(p.address ? { address: p.address } : {}),
  };
}

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
