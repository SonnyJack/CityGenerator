import { useEffect, useRef, useState } from 'react';
import {
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  addProtocol,
  setWorkerUrl,
  type RasterDEMTileSource,
  type VectorTileSource,
} from 'maplibre-gl';
// MapLibre resolves its tile-parsing worker relative to its own module URL, which a
// bundler does not preserve. Let Vite bundle the worker (with its shared chunk) and
// hand MapLibre the resulting URL.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { metersToLonLat } from '@citygen/core';
import { compileStyle, themeById, type LayerGroup } from '@citygen/themes';
import { engine } from '../engine/client.js';
import { useApp } from '../store.js';
import { renderPattern } from './patterns.js';

const SOURCE_ID = 'citygen';
const DEM_SOURCE_ID = 'citygen-dem';
const PROTOCOL = 'citygen';
const TILE_URL = `${PROTOCOL}://tiles/{z}/{x}/{y}`;
const DEM_URL = `${PROTOCOL}://dem/{z}/{x}/{y}`;

let protocolRegistered = false;

/** One-time MapLibre setup: worker location and the tile protocol served by the engine worker. */
function registerProtocol() {
  if (protocolRegistered) return;
  protocolRegistered = true;
  setWorkerUrl(maplibreWorkerUrl);
  addProtocol(PROTOCOL, async (params, abortController) => {
    const m = /(tiles|dem)\/(\d+)\/(\d+)\/(\d+)(?:\?v=(\d+))?/.exec(params.url);
    if (!m) throw new Error(`Bad tile url ${params.url}`);
    const [, kind, z, x, y, v] = m;
    const version = Number(v ?? 0);
    const data =
      kind === 'dem'
        ? await engine().getDemTile(version, Number(z), Number(x), Number(y))
        : await engine().getTile(version, Number(z), Number(x), Number(y));
    if (abortController.signal.aborted) throw new Error('aborted');
    if (!data) {
      // MapLibre treats an empty body as "no tile" (HTTP 204 semantics).
      return { data: new ArrayBuffer(0) };
    }
    return { data: data.buffer as ArrayBuffer };
  });
}

function styleFor(themeId: string | undefined, layers: Partial<Record<LayerGroup, boolean>>) {
  return compileStyle(themeById(themeId), {
    sourceId: SOURCE_ID,
    tileUrl: TILE_URL,
    demSourceId: DEM_SOURCE_ID,
    demTileUrl: DEM_URL,
    layers,
  });
}

/** Create the map, or return the error when the browser cannot provide WebGL. */
function createMap(container: HTMLDivElement, themeId: string | undefined): MapLibreMap | Error {
  try {
    return new MapLibreMap({
      container,
      style: styleFor(themeId, {}),
      center: [0, 0],
      zoom: 9,
      maxPitch: 70,
      attributionControl: false,
      canvasContextAttributes: { failIfMajorPerformanceCaveat: false },
    });
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

declare global {
  interface Window {
    /** The live map, for debugging and end-to-end tests. */
    __citygenMap?: MapLibreMap;
  }
}

/** Add the theme's pattern images to the map (idempotent). */
function ensurePatterns(map: MapLibreMap, themeId: string | undefined) {
  const theme = themeById(themeId);
  const ratio = Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1)));
  for (const spec of theme.patterns) {
    if (map.hasImage(spec.id)) continue;
    const img = renderPattern(spec, ratio);
    map.addImage(spec.id, { width: img.width, height: img.height, data: img.data }, { pixelRatio: ratio });
  }
}

function tileUrls(version: number) {
  return { vector: `${TILE_URL}?v=${version}`, dem: `${DEM_URL}?v=${version}` };
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const tileVersion = useApp((s) => s.tileVersion);
  const extent = useApp((s) => s.document.spec.extent);
  const themeId = useApp((s) => s.document.ui?.theme);
  const layerState = useApp((s) => s.document.ui?.layers);
  const terrain3d = useApp((s) => s.document.ui?.terrain3d ?? false);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    registerProtocol();
    const map = createMap(container.current, useApp.getState().document.ui?.theme);
    if (map instanceof Error) {
      const id = setTimeout(() => setWebglError(map.message), 0);
      return () => clearTimeout(id);
    }
    map.on('error', (e) => {
      console.error('MapLibre error', e.error);
      if (/WebGL/i.test(String(e.error?.message))) setWebglError(String(e.error?.message));
    });
    map.on('style.load', () => ensurePatterns(map, useApp.getState().document.ui?.theme));
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    window.__citygenMap = map;
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Point the sources at the new tile version whenever the engine regenerates.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || tileVersion === 0) return;
    const apply = () => {
      const urls = tileUrls(tileVersion);
      (map.getSource(SOURCE_ID) as VectorTileSource | undefined)?.setTiles([urls.vector]);
      (map.getSource(DEM_SOURCE_ID) as RasterDEMTileSource | undefined)?.setTiles([urls.dem]);
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [tileVersion]);

  // Theme or layer visibility changes: swap the style (sources keep the current tile version).
  const appliedStyle = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const key = JSON.stringify([themeId ?? 'atlas', layerState ?? {}]);
    if (appliedStyle.current === null) {
      // First run: the constructor already applied this theme.
      appliedStyle.current = key;
      return;
    }
    if (appliedStyle.current === key) return;
    appliedStyle.current = key;
    const style = styleFor(themeId, (layerState ?? {}) as Partial<Record<LayerGroup, boolean>>);
    const urls = tileUrls(useApp.getState().tileVersion);
    (style.sources[SOURCE_ID] as { tiles: string[] }).tiles = [urls.vector];
    (style.sources[DEM_SOURCE_ID] as { tiles: string[] }).tiles = [urls.dem];
    map.setStyle(style, { diff: true });
  }, [themeId, layerState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => map.setTerrain(terrain3d ? { source: DEM_SOURCE_ID, exaggeration: 1.4 } : null);
    if (map.isStyleLoaded()) apply();
    else map.once('style.load', apply);
  }, [terrain3d]);

  // Fit the region when its extent changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const [w, s] = metersToLonLat([-extent.widthM / 2, -extent.heightM / 2]);
    const [e, n] = metersToLonLat([extent.widthM / 2, extent.heightM / 2]);
    const fit = () => map.fitBounds([w, s, e, n], { padding: 24, duration: 0 });
    if (map.isStyleLoaded()) fit();
    else map.once('load', fit);
  }, [extent.widthM, extent.heightM]);

  return (
    <div className="relative h-full w-full" data-testid="map">
      <div ref={container} className="h-full w-full" />
      {webglError && (
        <div className="absolute inset-0 flex items-center justify-center bg-stone-100 p-6 text-center text-sm text-stone-700">
          <div>
            <p className="font-medium">The map view needs WebGL, which this browser could not provide.</p>
            <p className="mt-1 text-xs text-stone-500">{webglError}</p>
          </div>
        </div>
      )}
    </div>
  );
}
