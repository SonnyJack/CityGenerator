import type { Rng } from '../random/rng.js';
import type {
  CandidateInfo,
  FeatureSize,
  FeatureType,
  HardConstraint,
  LayoutInput,
  LocalPart,
  Pt,
  SoftScorer,
} from './types.js';

/**
 * The built-in facility library (DESIGN §6.6): ports, harbours, shipyards,
 * industry, institutions and airports, each with era variants in its layout.
 * Sizes are real-world metres; the engine applies scale compression.
 */

// --- Constraint and scorer primitives --------------------------------------------

const allLand: HardConstraint = (c) =>
  c.samples.every((p) => c.ctx.isLand(p[0], p[1])) ? null : 'not all on dry land';
const mostlyLand =
  (frac: number): HardConstraint =>
  (c) =>
    c.samples.filter((p) => c.ctx.isLand(p[0], p[1])).length >= c.samples.length * frac
      ? null
      : 'too much of it would be in the water';
const maxSlope =
  (s: number): HardConstraint =>
  (c) => {
    const land = c.samples.filter((p) => c.ctx.isLand(p[0], p[1]));
    if (!land.length) return 'no land';
    const mean = land.reduce((a, p) => a + c.ctx.slopeAt(p[0], p[1]), 0) / land.length;
    return mean <= s ? null : 'the ground is too steep';
  };
/** The +normal edge touches the sea, the −normal edge stands on land. */
const seaFront =
  (maxDistM: number): HardConstraint =>
  (c) => {
    const front = c.edges[2];
    const back = c.edges[3];
    if (c.ctx.distToSea(front[0], front[1]) > maxDistM) return 'not on the shore';
    if (!c.ctx.isLand(back[0], back[1])) return 'the landward side would be in the water';
    return null;
  };
const riverFront =
  (maxDistM: number): HardConstraint =>
  (c) => {
    const front = c.edges[2];
    if (c.ctx.distToWater(front[0], front[1]) > maxDistM || c.ctx.distToSea(front[0], front[1]) < 300)
      return 'not beside a river';
    return null;
  };
const awayFromCentre =
  (minFrac: number): HardConstraint =>
  (c) => {
    if (!c.host) return null;
    const d = Math.hypot(
      c.frame.center[0] - c.host.site.center[0],
      c.frame.center[1] - c.host.site.center[1],
    );
    return d >= minFrac * c.host.site.radiusM ? null : 'too close to the town centre';
  };
const elevationAtLeast =
  (m: number): HardConstraint =>
  (c) =>
    c.ctx.elevationAt(c.frame.center[0], c.frame.center[1]) >= m ? null : 'too low-lying';
const deepWater: HardConstraint = (c) => {
  const front = c.edges[2];
  const out: Pt = [
    front[0] + (front[0] - c.frame.center[0]) * 0.8,
    front[1] + (front[1] - c.frame.center[1]) * 0.8,
  ];
  return c.ctx.seaFraction(out[0], out[1], 250) > 0.35 ? null : 'the water off the quay is too shallow';
};

const scorer = (weight: number, score: (c: CandidateInfo) => number): SoftScorer => ({ weight, score });
const flat = scorer(1, (c) => 1 - Math.min(1, c.ctx.slopeAt(c.frame.center[0], c.frame.center[1]) / 0.1));
const nearRail = (w = 1) =>
  scorer(w, (c) => 1 - Math.min(1, c.ctx.distToRail(c.frame.center[0], c.frame.center[1]) / 2500));
const nearCentre = (w = 1) =>
  scorer(w, (c) =>
    c.host
      ? 1 -
        Math.min(
          1,
          Math.hypot(c.frame.center[0] - c.host.site.center[0], c.frame.center[1] - c.host.site.center[1]) /
            (2 * c.host.site.radiusM),
        )
      : 0,
  );
const farFromCentre = (w = 1) => scorer(w, (c) => 1 - nearCentre().score(c));
const downwind = (w = 1) =>
  scorer(w, (c) => {
    if (!c.host) return 0;
    const dx = c.frame.center[0] - c.host.site.center[0];
    const dy = c.frame.center[1] - c.host.site.center[1];
    const d = Math.hypot(dx, dy) || 1;
    return (dx * Math.cos(c.ctx.windFrom + Math.PI) + dy * Math.sin(c.ctx.windFrom + Math.PI)) / d;
  });
const upwind = (w = 1) => scorer(w, (c) => -downwind().score(c));
const sheltered = (w = 1) =>
  scorer(w, (c) => {
    const f = c.ctx.seaFraction(c.edges[2][0], c.edges[2][1], 900);
    // Half sea around the front edge = a bay; open sea or a narrow inlet score lower.
    return 1 - Math.abs(f - 0.5) * 2;
  });
const elevated = (w = 1) =>
  scorer(w, (c) => Math.min(1, c.ctx.elevationAt(c.frame.center[0], c.frame.center[1]) / 80));
const nearWater = (w = 1) =>
  scorer(w, (c) => 1 - Math.min(1, c.ctx.distToWater(c.frame.center[0], c.frame.center[1]) / 1500));
const nearSea = (w = 1) =>
  scorer(w, (c) => 1 - Math.min(1, c.ctx.distToSea(c.frame.center[0], c.frame.center[1]) / 3000));

// --- Layout helpers ----------------------------------------------------------------

const rect = (
  kind: LocalPart['kind'],
  u: number,
  v: number,
  lengthM: number,
  widthM: number,
  extra: Partial<Extract<LocalPart, { shape: 'rect' }>> = {},
): LocalPart => ({
  kind,
  shape: 'rect',
  u,
  v,
  lengthM,
  widthM,
  ...extra,
});
const circle = (
  kind: LocalPart['kind'],
  u: number,
  v: number,
  radiusM: number,
  name?: string,
): LocalPart => ({ kind, shape: 'circle', u, v, radiusM, ...(name ? { name } : {}) });
const line = (kind: LocalPart['kind'], points: Pt[], widthM?: number, name?: string): LocalPart => ({
  kind,
  shape: 'line',
  points,
  ...(widthM ? { widthM } : {}),
  ...(name ? { name } : {}),
});
const point = (kind: LocalPart['kind'], u: number, v: number, name?: string): LocalPart => ({
  kind,
  shape: 'point',
  u,
  v,
  ...(name ? { name } : {}),
});

/** A row of buildings along u at a given v. */
function row(
  kind: LocalPart['kind'],
  u0: number,
  u1: number,
  v: number,
  depth: number,
  unit: number,
  gap: number,
  rng: Rng,
  floors: [number, number],
  name?: string,
): LocalPart[] {
  const out: LocalPart[] = [];
  let u = u0;
  while (u + unit <= u1 + 1e-6) {
    const w = Math.min(unit, u1 - u) * rng.range(0.85, 1);
    out.push(
      rect(kind, u + w / 2, v, w, depth * rng.range(0.85, 1), {
        floors: rng.int(floors[0], floors[1]),
        ...(name ? { name } : {}),
      }),
    );
    u += unit + gap;
  }
  return out;
}

const sized =
  (small: [number, number], medium: [number, number], large: [number, number]) => (size: FeatureSize) =>
    size === 'small' ? small : size === 'large' ? large : medium;

// --- Ports and harbours --------------------------------------------------------------

function portLayout(i: LayoutInput): LocalPart[] {
  const { lengthM: L, widthM: W, year, rng } = i;
  const k = i.compression;
  const parts: LocalPart[] = [];
  const front = W / 2; // +v edge is the water
  if (year < 1900) {
    // Finger piers and wharves, bonded warehouses and a customs house behind.
    parts.push(rect('quay', 0, front - 6 * k, L, 12 * k, { name: 'Wharf' }));
    const piers = Math.max(2, Math.round(L / (90 * k)));
    for (let p = 0; p < piers; p++) {
      const u = -L / 2 + ((p + 0.5) / piers) * L;
      parts.push(rect('pier', u, front + (70 * k) / 2, 9 * k, 70 * k, { angle: Math.PI / 2 }));
    }
    parts.push(
      ...row(
        'warehouse',
        -L / 2 + 10,
        L / 2 - 10,
        front - 40 * k,
        30 * k,
        40 * k,
        8 * k,
        rng,
        [2, 4],
        'Bonded warehouse',
      ),
    );
    parts.push(
      rect('building', -L / 2 + 40 * k, -W / 2 + 25 * k, 40 * k, 24 * k, {
        floors: 2,
        name: 'Customs house',
      }),
    );
    parts.push(
      rect('building', L / 2 - 40 * k, -W / 2 + 22 * k, 30 * k, 18 * k, { floors: 2, name: 'Sail loft' }),
    );
    parts.push(rect('building', 0, -W / 2 + 18 * k, 26 * k, 14 * k, { floors: 1, name: 'Ship chandler' }));
    return parts;
  }
  if (year < 1965) {
    // Break-bulk quay with transit sheds, rail on the quay and cranes.
    parts.push(rect('quay', 0, front - 10 * k, L, 20 * k, { name: 'Quay' }));
    parts.push(
      line(
        'track',
        [
          [-L / 2, front - 16 * k],
          [L / 2, front - 16 * k],
        ],
        4,
        'Quay siding',
      ),
    );
    parts.push(
      line(
        'track',
        [
          [-L / 2, -W / 2 + 30 * k],
          [L / 2, -W / 2 + 30 * k],
        ],
        4,
        'Port siding',
      ),
    );
    const cranes = Math.max(3, Math.round(L / (70 * k)));
    for (let c = 0; c < cranes; c++)
      parts.push(point('crane', -L / 2 + ((c + 0.5) / cranes) * L, front - 6 * k, 'Crane'));
    parts.push(
      ...row(
        'shed',
        -L / 2 + 8,
        L / 2 - 8,
        front - 55 * k,
        40 * k,
        90 * k,
        14 * k,
        rng,
        [1, 2],
        'Transit shed',
      ),
    );
    parts.push(
      rect('building', L / 2 - 30 * k, -W / 2 + 60 * k, 24 * k, 24 * k, {
        floors: 8,
        name: 'Grain elevator',
      }),
    );
    parts.push(
      rect('building', -L / 2 + 40 * k, -W / 2 + 62 * k, 46 * k, 26 * k, { floors: 3, name: 'Cold store' }),
    );
    parts.push(rect('yard', 0, -W / 2 + 62 * k, L * 0.4, 40 * k, { name: 'Coal staithes' }));
    return parts;
  }
  // Container terminal: reclaimed quay, berths every 300 m, gantry cranes, yard grid, gate, Ro-Ro, tanks.
  parts.push(rect('quay', 0, front - 14 * k, L, 28 * k, { name: 'Container quay' }));
  const berths = Math.max(1, Math.round(L / (300 * k)));
  for (let b = 0; b < berths; b++) {
    const u = -L / 2 + ((b + 0.5) / berths) * L;
    parts.push(
      line(
        'berth',
        [
          [u - 140 * k, front + 6 * k],
          [u + 140 * k, front + 6 * k],
        ],
        6,
        `Berth ${b + 1}`,
      ),
    );
    for (let c = 0; c < 3; c++)
      parts.push(point('crane', u + (c - 1) * 45 * k, front - 8 * k, 'Gantry crane'));
  }
  const yardTop = front - 34 * k;
  const yardH = W * 0.45;
  parts.push(rect('containerYard', 0, yardTop - yardH / 2, L * 0.92, yardH, { name: 'Container yard' }));
  const lanes = Math.max(3, Math.round(yardH / (40 * k)));
  for (let l = 1; l < lanes; l++) {
    const v = yardTop - (l / lanes) * yardH;
    parts.push(
      line(
        'road',
        [
          [-L * 0.46, v],
          [L * 0.46, v],
        ],
        6,
      ),
    );
  }
  parts.push(
    line(
      'track',
      [
        [-L / 2, yardTop - yardH - 12 * k],
        [L / 2, yardTop - yardH - 12 * k],
      ],
      4,
      'Intermodal siding',
    ),
  );
  parts.push(
    rect('building', -L / 2 + 40 * k, -W / 2 + 20 * k, 50 * k, 20 * k, { floors: 1, name: 'Gate complex' }),
  );
  parts.push(rect('gate', -L / 2 + 40 * k, -W / 2 + 5 * k, 30 * k, 6 * k, { name: 'Gate' }));
  parts.push(rect('ramp', L / 2 - 40 * k, front - 2 * k, 40 * k, 16 * k, { name: 'Ro-Ro ramp' }));
  for (let t = 0; t < 4; t++)
    parts.push(
      circle(
        'tank',
        L / 2 - 30 * k - (t % 2) * 34 * k,
        -W / 2 + 40 * k + Math.floor(t / 2) * 34 * k,
        14 * k,
        'Tank',
      ),
    );
  parts.push(
    line(
      'breakwater',
      [
        [-L / 2 - 40 * k, front + 160 * k],
        [L / 2 + 60 * k, front + 160 * k],
      ],
      10,
      'Breakwater',
    ),
  );
  return parts;
}

const port: FeatureType = {
  id: 'port',
  name: 'Port',
  category: 'port',
  level: 'settlement',
  years: [1100, 2100],
  footprint: sized([300, 120], [600, 220], [1100, 420]),
  scaleCompression: 0.6,
  orientation: 'alignCoast',
  radial: [0.3, 1.6],
  hard: [seaFront(90), mostlyLand(0.5), maxSlope(0.12), deepWater],
  soft: [sheltered(1.4), flat, nearRail(0.8), nearCentre(0.6)],
  connectors: { rail: true, road: true },
  nuisance: { radiusM: 500, strength: 0.4 },
  ward: 'port',
  layout: portLayout,
};

const fishingHarbour: FeatureType = {
  id: 'harbour.fishing',
  name: 'Fishing harbour',
  category: 'port',
  level: 'settlement',
  years: [1100, 2100],
  footprint: sized([120, 70], [200, 90], [300, 120]),
  orientation: 'alignCoast',
  radial: [0.2, 1.3],
  hard: [seaFront(80), mostlyLand(0.55), maxSlope(0.14)],
  soft: [sheltered(1.2), nearCentre(0.8), flat],
  connectors: { road: true },
  ward: 'port',
  layout: ({ lengthM: L, widthM: W, year, rng, compression: k }) => {
    const front = W / 2;
    const parts: LocalPart[] = [rect('quay', 0, front - 5 * k, L, 10 * k, { name: 'Fish quay' })];
    parts.push(
      line(
        'breakwater',
        [
          [L / 2, front],
          [L / 2 + 30 * k, front + 60 * k],
        ],
        6,
        'Mole',
      ),
    );
    parts.push(rect('slipway', -L / 2 + 20 * k, front + 10 * k, 12 * k, 30 * k, { name: 'Slipway' }));
    parts.push(
      rect('building', -L / 2 + 50 * k, front - 24 * k, 30 * k, 14 * k, { floors: 1, name: 'Fish market' }),
    );
    parts.push(rect('building', 0, front - 24 * k, 18 * k, 12 * k, { floors: 2, name: 'Ice house' }));
    parts.push(
      ...row(
        'shed',
        L / 4 - 20 * k,
        L / 2 - 6,
        front - 22 * k,
        10 * k,
        14 * k,
        4 * k,
        rng,
        [1, 1],
        'Net loft',
      ),
    );
    parts.push(
      rect('building', -L / 2 + 20 * k, -W / 2 + 14 * k, 30 * k, 16 * k, {
        floors: 1,
        name: year < 1900 ? 'Smokehouse' : 'Cannery',
      }),
    );
    parts.push(
      rect('shed', L / 2 - 30 * k, -W / 2 + 14 * k, 34 * k, 16 * k, { floors: 1, name: 'Boat yard' }),
    );
    return parts;
  },
};

const marina: FeatureType = {
  id: 'harbour.marina',
  name: 'Marina',
  category: 'port',
  level: 'settlement',
  years: [1950, 2100],
  footprint: sized([150, 80], [250, 120], [400, 160]),
  orientation: 'alignCoast',
  radial: [0.2, 1.4],
  hard: [seaFront(80), mostlyLand(0.5), maxSlope(0.12)],
  soft: [sheltered(1.2), nearCentre(0.5)],
  connectors: { road: true },
  ward: 'port',
  layout: ({ lengthM: L, widthM: W, compression: k }) => {
    const front = W / 2;
    const parts: LocalPart[] = [rect('quay', 0, front - 4 * k, L, 8 * k)];
    const pontoons = Math.max(3, Math.round(L / (30 * k)));
    for (let p = 0; p < pontoons; p++)
      parts.push(
        line(
          'pier',
          [
            [-L / 2 + ((p + 0.5) / pontoons) * L, front],
            [-L / 2 + ((p + 0.5) / pontoons) * L, front + 50 * k],
          ],
          2,
          'Pontoon',
        ),
      );
    parts.push(
      line(
        'breakwater',
        [
          [-L / 2 - 20 * k, front + 80 * k],
          [L / 2 + 20 * k, front + 80 * k],
        ],
        8,
        'Breakwater',
      ),
    );
    parts.push(rect('building', 0, -W / 2 + 16 * k, 40 * k, 18 * k, { floors: 2, name: 'Clubhouse' }));
    parts.push(rect('yard', L / 4, -W / 2 + 22 * k, L / 3, 30 * k, { name: 'Boat park' }));
    return parts;
  },
};

const shipyard: FeatureType = {
  id: 'shipyard',
  name: 'Shipyard and dry dock',
  category: 'port',
  level: 'settlement',
  years: [1600, 2100],
  footprint: sized([200, 120], [350, 180], [600, 260]),
  scaleCompression: 0.6,
  orientation: 'alignCoast',
  radial: [0.35, 1.7],
  hard: [seaFront(90), mostlyLand(0.5), maxSlope(0.12), deepWater],
  soft: [sheltered(1), nearRail(0.6), flat, downwind(0.4)],
  connectors: { rail: true, road: true },
  nuisance: { radiusM: 450, strength: 0.45 },
  ward: 'port',
  layout: ({ lengthM: L, widthM: W, year, rng, compression: k }) => {
    const front = W / 2;
    const parts: LocalPart[] = [rect('quay', 0, front - 5 * k, L, 10 * k, { name: 'Fitting-out quay' })];
    // Graving dock cut into the quay with a caisson gate and pump house.
    const dockL = Math.min(L * 0.4, 160 * k);
    parts.push(
      rect('dock', -L / 4, front - dockL / 2, 30 * k, dockL, { angle: Math.PI / 2, name: 'Graving dock' }),
    );
    parts.push(rect('gate', -L / 4, front - 2 * k, 30 * k, 4 * k, { name: 'Caisson' }));
    parts.push(
      rect('building', -L / 4 - 28 * k, front - dockL - 12 * k, 16 * k, 12 * k, {
        floors: 2,
        name: 'Pump house',
      }),
    );
    const berths = Math.max(2, Math.round(L / (90 * k)));
    for (let b = 0; b < berths; b++) {
      const u = 0 + ((b + 0.5) / berths) * (L / 2);
      parts.push(
        rect('slipway', u, front - 30 * k, 18 * k, 80 * k, {
          angle: Math.PI / 2,
          name: year < 1900 ? 'Building berth' : 'Slipway',
        }),
      );
    }
    parts.push(
      ...row(
        year >= 1960 ? 'hall' : 'shed',
        -L / 2 + 10,
        L / 2 - 10,
        -W / 2 + 30 * k,
        40 * k,
        70 * k,
        10 * k,
        rng,
        [1, 2],
        year >= 1960 ? 'Fabrication hall' : 'Plate shop',
      ),
    );
    parts.push(
      rect('building', L / 2 - 30 * k, -W / 2 + 70 * k, 40 * k, 16 * k, { floors: 2, name: 'Mould loft' }),
    );
    for (let c = 0; c < 3; c++)
      parts.push(point('crane', -L / 2 + ((c + 0.5) / 3) * L, front - 12 * k, 'Crane'));
    if (year >= 1960)
      parts.push(rect('dock', L / 2 - 50 * k, front + 40 * k, 60 * k, 30 * k, { name: 'Floating dock' }));
    return parts;
  },
};

// --- Industry ---------------------------------------------------------------------------

const heavyIndustry: FeatureType = {
  id: 'industry.heavy',
  name: 'Heavy industry',
  category: 'industry',
  level: 'settlement',
  years: [1830, 2100],
  footprint: sized([220, 140], [400, 250], [700, 400]),
  scaleCompression: 0.6,
  orientation: 'alignRail',
  radial: [0.6, 2],
  hard: [allLand, maxSlope(0.06), awayFromCentre(0.5)],
  soft: [nearRail(1.5), downwind(1.2), flat, nearWater(0.5), farFromCentre(0.4)],
  connectors: { rail: true, road: true },
  nuisance: { radiusM: 900, strength: 0.7 },
  ward: 'industrial',
  layout: ({ lengthM: L, widthM: W, year, rng, compression: k }) => {
    const parts: LocalPart[] = [];
    parts.push(
      ...row('hall', -L / 2 + 10, L / 2 - 10, W / 4, W * 0.35, 90 * k, 12 * k, rng, [1, 2], 'Works hall'),
    );
    parts.push(
      line(
        'track',
        [
          [-L / 2, -W / 2 + 12 * k],
          [L / 2, -W / 2 + 12 * k],
        ],
        4,
        'Siding',
      ),
    );
    parts.push(
      line(
        'track',
        [
          [-L / 2, -W / 2 + 20 * k],
          [L / 2 - 40 * k, -W / 2 + 20 * k],
        ],
        4,
        'Siding',
      ),
    );
    const stacks = Math.max(2, Math.round(L / (110 * k)));
    for (let s = 0; s < stacks; s++)
      parts.push(point('chimney', -L / 2 + ((s + 0.5) / stacks) * L, W / 2 - 14 * k, 'Chimney'));
    if (year < 1960) {
      parts.push(
        rect('building', -L / 2 + 50 * k, -W / 2 + 50 * k, 60 * k, 24 * k, { floors: 1, name: 'Coke ovens' }),
      );
      parts.push(rect('slag', L / 2 - 50 * k, -W / 2 + 55 * k, 70 * k, 40 * k, { name: 'Slag heap' }));
    } else {
      parts.push(rect('yard', L / 2 - 60 * k, -W / 2 + 55 * k, 90 * k, 40 * k, { name: 'Stockyard' }));
    }
    for (let t = 0; t < 3; t++)
      parts.push(circle('tank', -L / 2 + 30 * k + t * 26 * k, -W / 2 + 90 * k, 10 * k, 'Tank'));
    if (year >= 1900)
      parts.push(
        ...[0, 1].map((c) =>
          circle('coolingTower', L / 4 + c * 40 * k, -W / 2 + 90 * k, 16 * k, 'Cooling tower'),
        ),
      );
    parts.push(
      line(
        'road',
        [
          [-L / 2, 0],
          [L / 2, 0],
        ],
        6,
        'Works road',
      ),
    );
    return parts;
  },
};

const gasworks: FeatureType = {
  id: 'industry.gasworks',
  name: 'Gasworks',
  category: 'industry',
  level: 'settlement',
  years: [1810, 1970],
  footprint: sized([120, 90], [180, 140], [260, 200]),
  orientation: 'alignRail',
  radial: [0.7, 1.5],
  hard: [allLand, maxSlope(0.07), awayFromCentre(0.55)],
  soft: [nearRail(1.2), downwind(1), nearWater(0.4), flat],
  connectors: { rail: true, road: true },
  nuisance: { radiusM: 600, strength: 0.6 },
  ward: 'industrial',
  layout: ({ lengthM: L, widthM: W, rng, compression: k }) => {
    const parts: LocalPart[] = [];
    const holders = rng.int(2, 3);
    for (let h = 0; h < holders; h++)
      parts.push(circle('gasholder', -L / 2 + 40 * k + h * 60 * k, W / 4, 24 * k, 'Gasholder'));
    parts.push(rect('building', L / 4, -W / 4, 70 * k, 26 * k, { floors: 2, name: 'Retort house' }));
    parts.push(point('chimney', L / 4 + 40 * k, -W / 4, 'Chimney'));
    parts.push(rect('yard', -L / 4, -W / 2 + 22 * k, 70 * k, 34 * k, { name: 'Coal yard' }));
    parts.push(circle('tank', L / 2 - 20 * k, W / 2 - 20 * k, 8 * k, 'Tar tank'));
    parts.push(
      line(
        'track',
        [
          [-L / 2, -W / 2 + 6 * k],
          [L / 2, -W / 2 + 6 * k],
        ],
        4,
        'Siding',
      ),
    );
    return parts;
  },
};

const mill: FeatureType = {
  id: 'industry.mill',
  name: 'Mill',
  category: 'industry',
  level: 'settlement',
  years: [1100, 1950],
  footprint: sized([80, 50], [120, 70], [200, 110]),
  orientation: 'alignRiver',
  radial: [0.2, 1.8],
  hard: [riverFront(90), mostlyLand(0.7), maxSlope(0.15)],
  soft: [nearWater(1.5), nearCentre(0.5), nearRail(0.3)],
  connectors: { road: true },
  nuisance: { radiusM: 250, strength: 0.3 },
  ward: 'industrial',
  layout: ({ lengthM: L, widthM: W, year, rng, compression: k }) => {
    const parts: LocalPart[] = [];
    const front = W / 2;
    parts.push(
      line(
        'race',
        [
          [-L / 2, front - 6 * k],
          [L / 2, front - 6 * k],
        ],
        3,
        'Mill race',
      ),
    );
    if (year < 1780) {
      parts.push(rect('wheelhouse', 0, front - 16 * k, 14 * k, 10 * k, { name: 'Wheel house' }));
      parts.push(rect('building', 0, front - 32 * k, 24 * k, 16 * k, { floors: 2, name: 'Mill' }));
      parts.push(rect('pond', -L / 2 + 20 * k, front + 14 * k, 36 * k, 24 * k, { name: 'Mill pond' }));
    } else {
      parts.push(
        rect('building', 0, front - 30 * k, Math.min(L * 0.7, 90 * k), 22 * k, {
          floors: year < 1850 ? 4 : 5,
          name: 'Mill',
        }),
      );
      parts.push(
        rect('wheelhouse', -L / 4, front - 12 * k, 12 * k, 10 * k, {
          name: year < 1850 ? 'Wheel house' : 'Engine house',
        }),
      );
      if (year >= 1850) parts.push(point('chimney', L / 4, front - 12 * k, 'Chimney'));
      parts.push(
        ...row(
          'building',
          -L / 2 + 6,
          L / 2 - 6,
          -W / 2 + 12 * k,
          12 * k,
          12 * k,
          2 * k,
          rng,
          [2, 2],
          "Workers' row",
        ),
      );
    }
    return parts;
  },
};

const logistics: FeatureType = {
  id: 'industry.logistics',
  name: 'Logistics park',
  category: 'industry',
  level: 'settlement',
  years: [1960, 2100],
  footprint: sized([250, 180], [400, 260], [700, 400]),
  scaleCompression: 0.6,
  orientation: 'alignRadial',
  radial: [1, 2.2],
  hard: [allLand, maxSlope(0.05), awayFromCentre(0.9)],
  soft: [flat, farFromCentre(0.8), nearRail(0.3)],
  connectors: { road: true },
  nuisance: { radiusM: 400, strength: 0.3 },
  ward: 'industrial',
  layout: ({ lengthM: L, widthM: W, rng, compression: k }) => {
    const parts: LocalPart[] = [
      line(
        'road',
        [
          [-L / 2, 0],
          [L / 2, 0],
        ],
        8,
        'Estate road',
      ),
    ];
    parts.push(
      ...row(
        'warehouse',
        -L / 2 + 10,
        L / 2 - 10,
        W / 4 + 6 * k,
        W * 0.36,
        110 * k,
        16 * k,
        rng,
        [1, 1],
        'Distribution centre',
      ),
    );
    parts.push(
      ...row(
        'warehouse',
        -L / 2 + 10,
        L / 2 - 10,
        -W / 4 - 6 * k,
        W * 0.36,
        90 * k,
        16 * k,
        rng,
        [1, 1],
        'Warehouse',
      ),
    );
    parts.push(rect('yard', -L / 2 + 40 * k, W / 2 - 14 * k, 70 * k, 20 * k, { name: 'Truck yard' }));
    return parts;
  },
};

const powerPlant: FeatureType = {
  id: 'industry.power',
  name: 'Power station',
  category: 'industry',
  level: 'settlement',
  years: [1885, 2100],
  footprint: sized([180, 120], [300, 200], [500, 320]),
  scaleCompression: 0.6,
  orientation: 'alignRail',
  radial: [0.7, 2.2],
  hard: [allLand, maxSlope(0.06), awayFromCentre(0.6)],
  soft: [nearWater(1.5), nearRail(1), downwind(0.8), flat],
  connectors: { rail: true, road: true },
  nuisance: { radiusM: 800, strength: 0.6 },
  ward: 'industrial',
  layout: ({ lengthM: L, widthM: W, year, compression: k }) => {
    const parts: LocalPart[] = [];
    parts.push(rect('hall', -L / 6, W / 6, L * 0.5, W * 0.4, { floors: 3, name: 'Turbine hall' }));
    parts.push(rect('building', -L / 6, -W / 4, L * 0.5, W * 0.25, { floors: 2, name: 'Boiler house' }));
    const stacks = year < 1960 ? 2 : 1;
    for (let s = 0; s < stacks; s++)
      parts.push(point('chimney', -L / 6 + (s - 0.5) * 40 * k, -W / 2 + 14 * k, 'Chimney'));
    if (year >= 1930)
      for (let c = 0; c < 2; c++)
        parts.push(circle('coolingTower', L / 3, (c - 0.5) * 60 * k, 24 * k, 'Cooling tower'));
    parts.push(rect('switchyard', L / 2 - 40 * k, W / 2 - 30 * k, 60 * k, 40 * k, { name: 'Switchyard' }));
    parts.push(
      line(
        'track',
        [
          [-L / 2, -W / 2 + 8 * k],
          [L / 2, -W / 2 + 8 * k],
        ],
        4,
        'Coal siding',
      ),
    );
    parts.push(
      rect('yard', -L / 2 + 40 * k, -W / 2 + 40 * k, 60 * k, 30 * k, {
        name: year < 1990 ? 'Coal stock' : 'Fuel store',
      }),
    );
    return parts;
  },
};

const refinery: FeatureType = {
  id: 'industry.refinery',
  name: 'Refinery',
  category: 'industry',
  level: 'settlement',
  years: [1900, 2100],
  footprint: sized([300, 220], [500, 350], [900, 600]),
  scaleCompression: 0.55,
  orientation: 'alignCoast',
  radial: [1, 2.6],
  hard: [mostlyLand(0.8), maxSlope(0.05), awayFromCentre(1)],
  soft: [nearSea(1.2), nearRail(1), downwind(1.2), farFromCentre(0.8), flat],
  connectors: { rail: true, road: true },
  nuisance: { radiusM: 1400, strength: 0.9 },
  ward: 'industrial',
  layout: ({ lengthM: L, widthM: W, rng, compression: k }) => {
    const parts: LocalPart[] = [];
    const cols = Math.max(3, Math.round(L / (60 * k)));
    const rows = Math.max(2, Math.round((W * 0.5) / (60 * k)));
    for (let c = 0; c < cols; c++)
      for (let r = 0; r < rows; r++)
        parts.push(
          circle(
            'tank',
            -L / 2 + ((c + 0.5) / cols) * L,
            -W / 2 + 30 * k + r * 58 * k,
            22 * k * rng.range(0.7, 1),
            'Storage tank',
          ),
        );
    parts.push(rect('hall', -L / 4, W / 4, L * 0.4, W * 0.3, { floors: 2, name: 'Process units' }));
    parts.push(rect('hall', L / 4, W / 4, L * 0.3, W * 0.25, { floors: 2, name: 'Cracker' }));
    parts.push(point('chimney', L / 2 - 30 * k, W / 2 - 20 * k, 'Flare stack'));
    parts.push(
      line(
        'track',
        [
          [-L / 2, -W / 2 + 8 * k],
          [L / 2, -W / 2 + 8 * k],
        ],
        4,
        'Tank-car siding',
      ),
    );
    parts.push(
      line(
        'road',
        [
          [-L / 2, 0],
          [L / 2, 0],
        ],
        6,
        'Pipe rack road',
      ),
    );
    return parts;
  },
};

const brewery: FeatureType = {
  id: 'industry.brewery',
  name: 'Brewery',
  category: 'industry',
  level: 'settlement',
  years: [1500, 2100],
  footprint: sized([70, 50], [120, 90], [200, 140]),
  orientation: 'alignRadial',
  radial: [0.3, 1.2],
  hard: [allLand, maxSlope(0.1)],
  soft: [nearWater(0.8), nearCentre(0.6), nearRail(0.4)],
  connectors: { road: true },
  nuisance: { radiusM: 200, strength: 0.2 },
  ward: 'industrial',
  layout: ({ lengthM: L, widthM: W, year, compression: k }) => [
    rect('building', -L / 4, 0, L * 0.4, W * 0.5, { floors: year < 1850 ? 3 : 5, name: 'Brewhouse' }),
    rect('building', L / 4, W / 4, L * 0.35, W * 0.3, { floors: 2, name: 'Maltings' }),
    rect('building', L / 4, -W / 4, L * 0.3, W * 0.25, { floors: 1, name: 'Cooperage' }),
    ...(year >= 1850 ? [point('chimney', 0, -W / 2 + 8 * k, 'Chimney')] : []),
    rect('yard', 0, -W / 2 + 10 * k, L * 0.5, 14 * k, { name: 'Dray yard' }),
  ],
};

const tannery: FeatureType = {
  id: 'industry.tannery',
  name: 'Tannery',
  category: 'industry',
  level: 'settlement',
  years: [1100, 1950],
  footprint: sized([60, 40], [100, 70], [160, 100]),
  orientation: 'alignRiver',
  radial: [0.4, 1.5],
  hard: [riverFront(120), mostlyLand(0.75), maxSlope(0.12)],
  soft: [nearWater(1.5), downwind(1.2), farFromCentre(0.6)],
  connectors: { road: true },
  nuisance: { radiusM: 350, strength: 0.6 },
  ward: 'industrial',
  layout: ({ lengthM: L, widthM: W, rng, compression: k }) => {
    const parts: LocalPart[] = [
      rect('building', -L / 4, -W / 4, L * 0.4, W * 0.4, { floors: 2, name: 'Tan house' }),
    ];
    const pits = Math.max(4, Math.round(L / (10 * k)));
    for (let p = 0; p < pits; p++)
      parts.push(
        rect('basin', -L / 2 + ((p + 0.5) / pits) * L, W / 2 - 10 * k, 6 * k, 6 * k, { name: 'Tan pit' }),
      );
    parts.push(rect('shed', L / 4, -W / 4, L * 0.3, W * 0.3, { floors: 2, name: 'Drying loft' }));
    void rng;
    return parts;
  },
};

// --- Institutions ----------------------------------------------------------------------

const campus: FeatureType = {
  id: 'institution.campus',
  name: 'University campus',
  category: 'institution',
  level: 'settlement',
  years: [1200, 2100],
  footprint: sized([200, 160], [400, 300], [700, 500]),
  scaleCompression: 0.7,
  orientation: 'alignRadial',
  radial: [0.5, 1.4],
  hard: [allLand, maxSlope(0.08)],
  soft: [upwind(0.6), elevated(0.5), nearCentre(0.7), flat],
  connectors: { road: true },
  ward: 'campus',
  layout: ({ lengthM: L, widthM: W, year, rng, compression: k }) => {
    const parts: LocalPart[] = [rect('grounds', 0, 0, L, W, { name: 'Campus' })];
    // A quad ringed by ranges, a library, and later laboratories.
    const qL = L * 0.4;
    const qW = W * 0.4;
    parts.push(rect('field', 0, 0, qL, qW, { name: 'Quad' }));
    parts.push(rect('building', 0, qW / 2 + 12 * k, qL + 24 * k, 20 * k, { floors: 3, name: 'Great hall' }));
    parts.push(rect('building', qL / 2 + 12 * k, 0, 20 * k, qW, { floors: 3, name: 'Library' }));
    parts.push(rect('building', -qL / 2 - 12 * k, 0, 20 * k, qW, { floors: 3, name: 'Range' }));
    if (year >= 1200)
      parts.push(rect('chapel', 0, -qW / 2 - 12 * k, 40 * k, 18 * k, { floors: 2, name: 'Chapel' }));
    if (year >= 1850)
      parts.push(
        ...row(
          'building',
          -L / 2 + 10,
          L / 2 - 10,
          W / 2 - 24 * k,
          30 * k,
          60 * k,
          14 * k,
          rng,
          [2, 4],
          'Laboratory',
        ),
      );
    if (year >= 1950)
      parts.push(
        ...row(
          'building',
          -L / 2 + 10,
          L / 2 - 10,
          -W / 2 + 24 * k,
          30 * k,
          50 * k,
          16 * k,
          rng,
          [4, 8],
          'Faculty block',
        ),
      );
    return parts;
  },
};

const hospital: FeatureType = {
  id: 'institution.hospital',
  name: 'Hospital',
  category: 'institution',
  level: 'settlement',
  years: [1700, 2100],
  footprint: sized([120, 90], [220, 160], [400, 280]),
  orientation: 'alignRadial',
  radial: [0.45, 1.3],
  hard: [allLand, maxSlope(0.08)],
  soft: [upwind(0.8), elevated(0.4), nearCentre(0.5), flat],
  connectors: { road: true },
  ward: 'institution',
  layout: ({ lengthM: L, widthM: W, year, rng, compression: k }) => {
    const parts: LocalPart[] = [rect('grounds', 0, 0, L, W)];
    if (year < 1950) {
      // Pavilion plan: a spine with wards off it.
      parts.push(rect('building', 0, W / 2 - 16 * k, L * 0.8, 16 * k, { floors: 3, name: 'Administration' }));
      parts.push(
        line(
          'road',
          [
            [-L * 0.4, W / 2 - 30 * k],
            [L * 0.4, W / 2 - 30 * k],
          ],
          4,
        ),
      );
      const wards = Math.max(2, Math.round(L / (45 * k)));
      for (let w = 0; w < wards; w++)
        parts.push(
          rect('building', -L * 0.4 + ((w + 0.5) / wards) * L * 0.8, -W / 8, 14 * k, W * 0.5, {
            floors: 2,
            name: 'Ward pavilion',
          }),
        );
      parts.push(
        rect('chapel', L / 2 - 20 * k, -W / 2 + 14 * k, 24 * k, 12 * k, { floors: 1, name: 'Chapel' }),
      );
    } else {
      parts.push(rect('building', 0, 0, L * 0.6, W * 0.4, { floors: rng.int(5, 9), name: 'Main block' }));
      parts.push(rect('building', 0, -W / 2 + 20 * k, L * 0.4, 24 * k, { floors: 1, name: 'Emergency' }));
      parts.push(rect('yard', L / 2 - 40 * k, W / 2 - 30 * k, 70 * k, 40 * k, { name: 'Car park' }));
    }
    return parts;
  },
};

const asylum: FeatureType = {
  id: 'institution.asylum',
  name: 'Asylum',
  category: 'institution',
  level: 'settlement',
  years: [1800, 1990],
  footprint: sized([200, 150], [320, 240], [500, 360]),
  scaleCompression: 0.7,
  orientation: 'alignRadial',
  radial: [1.1, 2.4],
  hard: [allLand, maxSlope(0.09), awayFromCentre(1)],
  soft: [farFromCentre(1), elevated(0.6), upwind(0.4), flat],
  connectors: { road: true },
  ward: 'institution',
  layout: ({ lengthM: L, widthM: W, compression: k }) => {
    const parts: LocalPart[] = [rect('grounds', 0, 0, L, W, { name: 'Grounds' })];
    parts.push(rect('building', 0, 0, L * 0.7, 18 * k, { floors: 3, name: 'Main range' }));
    for (const s of [-1, 1])
      parts.push(rect('building', s * L * 0.3, -W * 0.15, 16 * k, W * 0.3, { floors: 3, name: 'Wing' }));
    parts.push(rect('building', 0, W * 0.2, 30 * k, 22 * k, { floors: 4, name: 'Water tower and clock' }));
    parts.push(rect('chapel', L * 0.3, W * 0.28, 28 * k, 14 * k, { floors: 1, name: 'Chapel' }));
    parts.push(rect('field', -L * 0.3, W * 0.25, L * 0.3, W * 0.3, { name: 'Airing court' }));
    parts.push(rect('wall', 0, 0, L, W));
    return parts;
  },
};

const prison: FeatureType = {
  id: 'institution.prison',
  name: 'Prison',
  category: 'institution',
  level: 'settlement',
  years: [1780, 2100],
  footprint: sized([120, 100], [200, 160], [320, 260]),
  orientation: 'alignRadial',
  radial: [0.7, 1.8],
  hard: [allLand, maxSlope(0.08), awayFromCentre(0.6)],
  soft: [farFromCentre(0.7), flat, downwind(0.3)],
  connectors: { road: true },
  nuisance: { radiusM: 300, strength: 0.3 },
  ward: 'institution',
  layout: ({ lengthM: L, widthM: W, year, compression: k }) => {
    const parts: LocalPart[] = [rect('wall', 0, 0, L, W, { name: 'Perimeter wall' })];
    if (year < 1960) {
      // Radial wings around a central hall.
      parts.push(rect('building', 0, 0, 26 * k, 26 * k, { floors: 3, name: 'Central hall' }));
      for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
        parts.push(
          rect('building', Math.cos(a) * L * 0.22, Math.sin(a) * W * 0.22, L * 0.3, 14 * k, {
            angle: a,
            floors: 3,
            name: 'Cell wing',
          }),
        );
    } else {
      parts.push(rect('building', 0, 0, L * 0.6, W * 0.35, { floors: 3, name: 'Cell block' }));
      parts.push(rect('field', 0, -W * 0.3, L * 0.6, W * 0.25, { name: 'Exercise yard' }));
    }
    parts.push(rect('gate', 0, W / 2 - 3 * k, 14 * k, 6 * k, { name: 'Gatehouse' }));
    return parts;
  },
};

const military: FeatureType = {
  id: 'institution.military',
  name: 'Military base',
  category: 'institution',
  level: 'settlement',
  years: [1600, 2100],
  footprint: sized([250, 180], [500, 350], [900, 600]),
  scaleCompression: 0.6,
  orientation: 'alignRadial',
  radial: [1, 2.5],
  hard: [allLand, maxSlope(0.08), awayFromCentre(0.9)],
  soft: [farFromCentre(1), flat, nearRail(0.4)],
  connectors: { road: true },
  nuisance: { radiusM: 500, strength: 0.3 },
  ward: 'institution',
  layout: ({ lengthM: L, widthM: W, year, rng, compression: k }) => {
    const parts: LocalPart[] = [rect('fence', 0, 0, L, W, { name: 'Perimeter' })];
    parts.push(rect('field', -L / 4, 0, L * 0.4, W * 0.5, { name: 'Parade ground' }));
    parts.push(...row('building', 0, L / 2 - 10, W / 4, 20 * k, 40 * k, 8 * k, rng, [2, 3], 'Barracks'));
    parts.push(...row('building', 0, L / 2 - 10, -W / 4, 20 * k, 40 * k, 8 * k, rng, [2, 3], 'Barracks'));
    parts.push(rect('building', -L / 4, W / 2 - 16 * k, 60 * k, 16 * k, { floors: 2, name: 'Headquarters' }));
    if (year >= 1900)
      parts.push(rect('yard', -L / 4, -W / 2 + 20 * k, 80 * k, 30 * k, { name: 'Vehicle park' }));
    parts.push(rect('gate', 0, W / 2 - 3 * k, 12 * k, 6 * k, { name: 'Guardroom' }));
    return parts;
  },
};

const cemetery: FeatureType = {
  id: 'institution.cemetery',
  name: 'Cemetery',
  category: 'institution',
  level: 'settlement',
  years: [1100, 2100],
  footprint: sized([100, 80], [220, 180], [400, 300]),
  orientation: 'alignRadial',
  radial: [0.8, 1.7],
  hard: [allLand, maxSlope(0.12)],
  soft: [farFromCentre(0.6), elevated(0.3), flat],
  connectors: { road: true },
  ward: 'cemetery',
  layout: ({ lengthM: L, widthM: W, year, compression: k }) => {
    const parts: LocalPart[] = [rect('graves', 0, 0, L, W, { name: 'Burial ground' })];
    parts.push(rect('wall', 0, 0, L, W));
    parts.push(
      line(
        'road',
        [
          [0, W / 2],
          [0, -W / 2],
        ],
        3,
        'Avenue',
      ),
    );
    parts.push(
      line(
        'road',
        [
          [-L / 2, 0],
          [L / 2, 0],
        ],
        3,
      ),
    );
    parts.push(
      rect('chapel', 0, -W * 0.3, 20 * k, 12 * k, {
        floors: 1,
        name: year < 1800 ? 'Church' : 'Mortuary chapel',
      }),
    );
    parts.push(rect('gate', 0, W / 2 - 3 * k, 10 * k, 6 * k, { name: 'Lychgate' }));
    return parts;
  },
};

const waterworks: FeatureType = {
  id: 'institution.waterworks',
  name: 'Waterworks',
  category: 'institution',
  level: 'settlement',
  years: [1800, 2100],
  footprint: sized([90, 70], [150, 100], [260, 180]),
  orientation: 'alignRadial',
  radial: [0.8, 2],
  hard: [allLand, maxSlope(0.08)],
  soft: [nearWater(1.2), elevated(0.8), upwind(0.5)],
  connectors: { road: true },
  ward: 'institution',
  layout: ({ lengthM: L, widthM: W, year, compression: k }) => [
    rect('reservoir', -L / 4, 0, L * 0.4, W * 0.7, { name: 'Filter beds' }),
    rect('building', L / 4, W / 4, L * 0.3, W * 0.3, {
      floors: 2,
      name: year < 1930 ? 'Beam engine house' : 'Pumping station',
    }),
    ...(year < 1930 ? [point('chimney', L / 4 + 20 * k, W / 4, 'Chimney')] : []),
    circle('reservoir', L / 4, -W / 4, Math.min(L, W) * 0.18, 'Service reservoir'),
  ],
};

const observatory: FeatureType = {
  id: 'institution.observatory',
  name: 'Observatory',
  category: 'institution',
  level: 'settlement',
  years: [1650, 2100],
  footprint: sized([40, 40], [70, 60], [120, 100]),
  orientation: 'free',
  radial: [0.9, 2.6],
  hard: [allLand, maxSlope(0.2), elevationAtLeast(25)],
  soft: [elevated(2), farFromCentre(0.8)],
  connectors: { road: true },
  ward: 'institution',
  layout: ({ lengthM: L, widthM: W, compression: k }) => [
    rect('building', -L / 6, 0, L * 0.5, W * 0.5, { floors: 2, name: 'Observatory' }),
    circle('dome', L / 4, 0, Math.min(L, W) * 0.18, 'Dome'),
    rect('grounds', 0, 0, L, W),
    circle('tower', -L / 2 + 8 * k, W / 2 - 8 * k, 4 * k, 'Transit house'),
  ],
};

const airport: FeatureType = {
  id: 'transport.airport',
  name: 'Airport',
  category: 'transport',
  level: 'settlement',
  years: [1925, 2100],
  footprint: sized([900, 400], [1800, 700], [3000, 1200]),
  scaleCompression: 0.5,
  orientation: 'alignWind',
  radial: [1.4, 3.2],
  hard: [allLand, maxSlope(0.03), awayFromCentre(1.3)],
  soft: [flat, farFromCentre(0.8)],
  connectors: { road: true, rail: true },
  nuisance: { radiusM: 2500, strength: 0.6 },
  ward: 'airfield',
  layout: ({ lengthM: L, widthM: W, year, rng, compression: k }) => {
    const parts: LocalPart[] = [rect('field', 0, 0, L, W, { name: 'Airfield' })];
    if (year < 1945) {
      parts.push(
        ...row(
          'hangar',
          -L / 2 + 20,
          -L / 2 + 20 + L * 0.4,
          -W / 2 + 30 * k,
          40 * k,
          50 * k,
          10 * k,
          rng,
          [1, 1],
          'Hangar',
        ),
      );
      parts.push(
        rect('building', 0, -W / 2 + 24 * k, 40 * k, 18 * k, {
          floors: 2,
          name: 'Terminal and control tower',
        }),
      );
      parts.push(rect('apron', 0, -W / 2 + 60 * k, L * 0.5, 40 * k, { name: 'Apron' }));
      if (year >= 1935) parts.push(rect('runway', 0, W / 8, L * 0.85, 30 * k, { name: 'Runway' }));
    } else {
      parts.push(rect('runway', 0, W / 4, L * 0.92, 45 * k, { name: 'Main runway' }));
      if (year >= 1970 && W > 500)
        parts.push(rect('runway', 0, -W / 3, L * 0.7, 45 * k, { name: 'Second runway' }));
      parts.push(
        line(
          'road',
          [
            [-L * 0.45, W / 4 - 40 * k],
            [L * 0.45, W / 4 - 40 * k],
          ],
          14,
          'Taxiway',
        ),
      );
      parts.push(rect('apron', 0, -W / 2 + 90 * k, L * 0.45, 80 * k, { name: 'Apron' }));
      parts.push(rect('terminal', 0, -W / 2 + 40 * k, L * 0.35, 30 * k, { floors: 2, name: 'Terminal' }));
      parts.push(circle('tower', L * 0.22, -W / 2 + 40 * k, 6 * k, 'Control tower'));
      parts.push(
        ...row(
          'hangar',
          -L * 0.45,
          -L * 0.25,
          -W / 2 + 80 * k,
          60 * k,
          70 * k,
          12 * k,
          rng,
          [1, 1],
          'Hangar',
        ),
      );
      parts.push(rect('yard', L * 0.3, -W / 2 + 30 * k, L * 0.15, 40 * k, { name: 'Car park' }));
    }
    return parts;
  },
};

export const FEATURE_TYPES: FeatureType[] = [
  port,
  fishingHarbour,
  marina,
  shipyard,
  heavyIndustry,
  gasworks,
  mill,
  logistics,
  powerPlant,
  refinery,
  brewery,
  tannery,
  campus,
  hospital,
  asylum,
  prison,
  military,
  cemetery,
  waterworks,
  observatory,
  airport,
];

export function featureTypeMap(extra: FeatureType[] = []): Map<string, FeatureType> {
  const m = new Map<string, FeatureType>();
  for (const t of [...FEATURE_TYPES, ...extra]) m.set(t.id, t);
  return m;
}

/** Constraint and scorer primitives exported for custom types. */
export const primitives = {
  allLand,
  mostlyLand,
  maxSlope,
  seaFront,
  riverFront,
  awayFromCentre,
  elevationAtLeast,
  deepWater,
  flat,
  nearRail,
  nearCentre,
  farFromCentre,
  downwind,
  upwind,
  sheltered,
  elevated,
  nearWater,
  nearSea,
  rect,
  circle,
  line,
  point,
  row,
};
