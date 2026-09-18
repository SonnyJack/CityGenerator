/**
 * Themes are authored as a small palette + per-class paint table and compiled
 * to a MapLibre style. Phase 0 ships the `atlas` palette and layers for the
 * placeholder region outline; the full class table (DESIGN §8.2) grows with
 * the pipeline.
 */

export interface ThemePalette {
  background: string;
  land: string;
  water: string;
  ink: string;
  inkMuted: string;
  accent: string;
  label: string;
  labelHalo: string;
}

export interface Theme {
  id: string;
  name: string;
  palette: ThemePalette;
  /** Contour interval in metres by zoom band, for later phases. */
  contourIntervalM: { zoom: number; interval: number }[];
}

export const atlas: Theme = {
  id: 'atlas',
  name: 'Atlas',
  palette: {
    background: '#e9e5dc',
    land: '#f2efe6',
    water: '#a9c8de',
    ink: '#2b2b2b',
    inkMuted: '#8a8578',
    accent: '#c0392b',
    label: '#2b2b2b',
    labelHalo: '#f2efe6',
  },
  contourIntervalM: [
    { zoom: 0, interval: 100 },
    { zoom: 12, interval: 20 },
    { zoom: 15, interval: 5 },
  ],
};

export const ink: Theme = {
  id: 'ink',
  name: 'Ink',
  palette: {
    background: '#f7f3ea',
    land: '#f7f3ea',
    water: '#f7f3ea',
    ink: '#1a1a1a',
    inkMuted: '#6d6d6d',
    accent: '#1a1a1a',
    label: '#1a1a1a',
    labelHalo: '#f7f3ea',
  },
  contourIntervalM: [
    { zoom: 0, interval: 100 },
    { zoom: 12, interval: 20 },
    { zoom: 15, interval: 5 },
  ],
};

export const themes: Record<string, Theme> = { atlas, ink };
