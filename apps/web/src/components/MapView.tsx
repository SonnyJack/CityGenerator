import { useEffect, useRef, useState } from 'react';
import {
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  addProtocol,
  setWorkerUrl,
  type VectorTileSource,
} from 'maplibre-gl';
// MapLibre resolves its tile-parsing worker relative to its own module URL, which a
// bundler does not preserve. Let Vite bundle the worker (with its shared chunk) and
// hand MapLibre the resulting URL.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { metersToLonLat } from '@citygen/core';
import { atlas, compileStyle } from '@citygen/themes';
import { engine } from '../engine/client.js';
import { useApp } from '../store.js';

const SOURCE_ID = 'citygen';
const PROTOCOL = 'citygen';
const TILE_URL = `${PROTOCOL}://tiles/{z}/{x}/{y}`;

let protocolRegistered = false;

/** One-time MapLibre setup: worker location and the tile protocol served by the engine worker. */
function registerProtocol() {
  if (protocolRegistered) return;
  protocolRegistered = true;
  setWorkerUrl(maplibreWorkerUrl);
  addProtocol(PROTOCOL, async (params, abortController) => {
    const m = /tiles\/(\d+)\/(\d+)\/(\d+)(?:\?v=(\d+))?/.exec(params.url);
    if (!m) throw new Error(`Bad tile url ${params.url}`);
    const [, z, x, y, v] = m;
    const data = await engine().getTile(Number(v ?? 0), Number(z), Number(x), Number(y));
    if (abortController.signal.aborted) throw new Error('aborted');
    return { data: data ? data.buffer : new ArrayBuffer(0) };
  });
}

/** Create the map, or return the error when the browser cannot provide WebGL. */
function createMap(container: HTMLDivElement): MapLibreMap | Error {
  try {
    return new MapLibreMap({
      container,
      style: compileStyle(atlas, { sourceId: SOURCE_ID, tileUrl: TILE_URL }),
      center: [0, 0],
      zoom: 9,
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

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const tileVersion = useApp((s) => s.tileVersion);
  const extent = useApp((s) => s.document.spec.extent);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    registerProtocol();
    const map = createMap(container.current);
    if (map instanceof Error) {
      // Report asynchronously: effects must not set state synchronously.
      const id = setTimeout(() => setWebglError(map.message), 0);
      return () => clearTimeout(id);
    }
    map.on('error', (e) => {
      console.error('MapLibre error', e.error);
      if (/WebGL/i.test(String(e.error?.message))) setWebglError(String(e.error?.message));
    });
    window.__citygenMap = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Point the source at the new tile version whenever the engine regenerates.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || tileVersion === 0) return;
    const apply = () => {
      const source = map.getSource(SOURCE_ID) as VectorTileSource | undefined;
      source?.setTiles([`${TILE_URL}?v=${tileVersion}`]);
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [tileVersion]);

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
