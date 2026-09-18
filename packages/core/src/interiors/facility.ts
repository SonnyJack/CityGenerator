import type { FloorProgramme, RoomSpec } from './programme.js';

/**
 * Room programmes for the buildings inside facilities (warehouses, halls,
 * wards, cell blocks, gatehouses, terminals…). A part is described by its
 * kind (from the layout) and its display name; the name decides when it is
 * specific ("Turbine hall", "Cell block"), the kind otherwise.
 */

/** Part kinds that have an inside worth planning. */
export const INTERIOR_PART_KINDS: ReadonlySet<string> = new Set([
  'building',
  'hall',
  'warehouse',
  'shed',
  'hangar',
  'terminal',
  'chapel',
  'tower',
  'wheelhouse',
  'dome',
  'gate',
]);

const floorName = (floor: number) => (floor === 0 ? 'ground floor' : `floor ${floor + 1}`);

const numbered = (name: string, count: number, share: number, opts: Partial<RoomSpec> = {}): RoomSpec[] =>
  Array.from({ length: count }, (_, i) => ({
    name: `${name} ${i + 1}`,
    share,
    ...opts,
    front: i === 0 && !!opts.front,
  }));

const offices = (areaM2: number, floor: number, head: string): FloorProgramme => ({
  name: floorName(floor),
  rooms:
    floor === 0
      ? [
          { name: 'entrance hall', share: 1.2, front: true },
          { name: 'general office', share: 3, front: true },
          { name: head, share: 1.4 },
          { name: 'records', share: 1, blind: true },
          ...(areaM2 > 200 ? [{ name: 'meeting room', share: 1.5 }] : []),
        ]
      : [
          { name: 'corridor', share: 0.8 },
          ...numbered('office', Math.max(2, Math.round(areaM2 / 30)), 1.5, { front: true }),
          { name: 'store', share: 0.6, blind: true },
        ],
});

const workshop = (label: string, floor: number, extra: RoomSpec[] = []): FloorProgramme => ({
  name: floorName(floor),
  rooms:
    floor === 0
      ? [{ name: label, share: 6, front: true }, { name: 'office', share: 1, front: true }, ...extra]
      : [
          { name: 'upper floor', share: 5, front: true },
          { name: 'hoist', share: 0.4, blind: true },
          { name: 'store', share: 1, blind: true },
        ],
});

const byName: [RegExp, (areaM2: number, floor: number, year: number) => FloorProgramme][] = [
  [
    /turbine hall/,
    (_, f) => ({
      name: f === 0 ? 'turbine floor' : 'gallery',
      rooms:
        f === 0
          ? [
              { name: 'turbine hall', share: 6, front: true },
              { name: 'control room', share: 1.2, front: true },
              { name: 'switchgear', share: 1.2, blind: true },
              { name: 'workshop', share: 1 },
            ]
          : [
              { name: 'crane gallery', share: 4, front: true },
              { name: 'store', share: 1, blind: true },
            ],
    }),
  ],
  [
    /retort house/,
    (_, f) => ({
      name: floorName(f),
      rooms: [
        { name: 'retort house', share: 5, front: true },
        { name: 'coal store', share: 1.5, blind: true },
        { name: 'purifier room', share: 1.5 },
        { name: 'stoker’s room', share: 0.6 },
      ],
    }),
  ],
  [
    /brewhouse/,
    (_, f) => ({
      name: f === 0 ? 'ground floor' : f === 1 ? 'copper floor' : 'cooling loft',
      rooms:
        f === 0
          ? [
              { name: 'mash tun room', share: 3, front: true },
              { name: 'fermenting room', share: 3 },
              { name: 'hop store', share: 1, blind: true },
              { name: 'racking room', share: 1.5 },
            ]
          : f === 1
            ? [
                { name: 'copper room', share: 3, front: true },
                { name: 'malt store', share: 1.5, blind: true },
                { name: 'brewer’s office', share: 0.8 },
              ]
            : [
                { name: 'cooling loft', share: 4, front: true },
                { name: 'liquor tanks', share: 1, blind: true },
              ],
    }),
  ],
  [
    /maltings/,
    (_, f) => ({
      name: f === 0 ? 'ground floor' : 'germination floor',
      rooms:
        f === 0
          ? [
              { name: 'steep', share: 1.5, blind: true },
              { name: 'germination floor', share: 4, front: true },
              { name: 'kiln', share: 1.5, blind: true },
              { name: 'barley store', share: 1.5, blind: true },
            ]
          : [
              { name: 'germination floor', share: 5, front: true },
              { name: 'kiln', share: 1.5, blind: true },
            ],
    }),
  ],
  [
    /cell (block|wing)/,
    (a, f) => ({
      name: f === 0 ? 'ground landing' : `landing ${f + 1}`,
      rooms: [
        { name: 'landing', share: 2.5, front: true },
        ...numbered('cell', Math.max(2, Math.min(12, Math.round(a / 12))), 0.5, { blind: true }),
        { name: f === 0 ? 'warder’s office' : 'warder’s post', share: 0.8, front: true },
        ...(f === 0 ? [{ name: 'association room', share: 1.5 }] : []),
      ],
    }),
  ],
  [
    /ward pavilion|main block|^wing$/,
    (a, f) => ({
      name: f === 0 ? 'ground floor' : `ward floor ${f + 1}`,
      rooms: [
        { name: f === 0 ? 'day room' : 'ward', share: f === 0 ? 1.5 : 5, front: true },
        ...(f === 0 ? [{ name: 'ward', share: 4, front: true }] : []),
        { name: 'sister’s office', share: 0.7 },
        { name: 'sluice', share: 0.5, blind: true },
        { name: 'linen store', share: 0.5, blind: true },
        ...(a > 300 ? [{ name: 'side ward', share: 1.2 }] : []),
      ],
    }),
  ],
  [
    /emergency/,
    () => ({
      name: 'ground floor',
      rooms: [
        { name: 'ambulance bay', share: 1.5, front: true },
        { name: 'casualty hall', share: 3, front: true },
        { name: 'treatment room 1', share: 1 },
        { name: 'treatment room 2', share: 1 },
        { name: 'dispensary', share: 0.7, blind: true },
        { name: 'office', share: 0.7 },
      ],
    }),
  ],
  [
    /gatehouse|guardroom|gate complex/,
    (_, f) => ({
      name: floorName(f),
      rooms:
        f === 0
          ? [
              { name: 'guardroom', share: 2.5, front: true },
              { name: 'gate lodge', share: 1, front: true },
              { name: 'armoury', share: 0.7, blind: true },
              { name: 'holding cell', share: 0.5, blind: true },
            ]
          : [
              { name: 'guard quarters', share: 3, front: true },
              { name: 'store', share: 0.8, blind: true },
            ],
    }),
  ],
  [
    /main range|^range$|quad/,
    (a, f) => ({
      name: floorName(f),
      rooms: [
        { name: 'corridor', share: 1 },
        ...numbered('lecture room', Math.max(2, Math.round(a / 60)), 2, { front: true }),
        ...(f === 0
          ? [
              { name: 'common room', share: 1.5 },
              { name: 'porter’s lodge', share: 0.6 },
            ]
          : [{ name: 'study', share: 1 }]),
      ],
    }),
  ],
  [/headquarters|administration|customs house/, (a, f) => offices(a, f, 'director’s office')],
  [
    /clubhouse/,
    (_, f) => ({
      name: floorName(f),
      rooms:
        f === 0
          ? [
              { name: 'bar', share: 2.5, front: true },
              { name: 'lounge', share: 2, front: true },
              { name: 'kitchen', share: 1 },
              { name: 'changing rooms', share: 1.2, blind: true },
              { name: 'store', share: 0.6, blind: true },
            ]
          : [
              { name: 'committee room', share: 2, front: true },
              { name: 'steward’s flat', share: 2 },
            ],
    }),
  ],
  [
    /fish market/,
    (_, f) =>
      workshop('market floor', f, [
        { name: 'auction stand', share: 1 },
        { name: 'ice store', share: 1, blind: true },
      ]),
  ],
  [
    /ice house|cold store/,
    (_, f) => ({
      name: floorName(f),
      rooms: [
        { name: 'loading', share: 1, front: true },
        { name: 'ice store', share: 5, blind: true },
        { name: 'engine room', share: 1 },
      ],
    }),
  ],
  [
    /boiler house/,
    (_, f) =>
      workshop('boiler room', f, [
        { name: 'coal store', share: 2, blind: true },
        { name: 'stoker’s room', share: 0.6 },
      ]),
  ],
  [
    /pump house|wheel house/,
    (_, f) =>
      workshop('engine room', f, [
        { name: 'pump well', share: 1, blind: true },
        { name: 'stores', share: 0.8, blind: true },
      ]),
  ],
  [/cooperage/, (_, f) => workshop('cooperage', f, [{ name: 'stave store', share: 1.5, blind: true }])],
  [
    /sail loft|mould loft|drying loft/,
    (_, f) => workshop('loft floor', f, [{ name: 'store', share: 1, blind: true }]),
  ],
  [
    /tan house/,
    (_, f) =>
      workshop('tan house', f, [
        { name: 'drying room', share: 2 },
        { name: 'hide store', share: 1, blind: true },
      ]),
  ],
  [
    /ship chandler/,
    (_, f) => workshop('chandler’s shop', f, [{ name: 'rope store', share: 1.5, blind: true }]),
  ],
  [
    /terminal/,
    (a, f) => ({
      name: f === 0 ? 'concourse' : f === 1 ? 'departures' : 'control level',
      rooms:
        f === 0
          ? [
              { name: 'concourse', share: 4, front: true },
              { name: 'check-in hall', share: 2, front: true },
              { name: 'customs', share: 1.2 },
              { name: 'baggage hall', share: 1.5, blind: true },
              { name: 'offices', share: 1 },
            ]
          : f === 1
            ? [
                { name: 'departure lounge', share: 4, front: true },
                { name: 'restaurant', share: 1.5, front: true },
                { name: 'kitchen', share: 0.8 },
                { name: 'offices', share: 1 },
              ]
            : [
                { name: 'control room', share: 3, front: true },
                { name: 'equipment room', share: 1, blind: true },
                ...(a > 100 ? [{ name: 'rest room', share: 0.8 }] : []),
              ],
    }),
  ],
  [
    /hangar/,
    (_, f) => ({
      name: floorName(f),
      rooms: [
        { name: 'hangar floor', share: 8, front: true },
        { name: 'workshop', share: 1.2 },
        { name: 'stores', share: 1, blind: true },
        { name: 'crew room', share: 0.8 },
      ],
    }),
  ],
  [
    /chapel/,
    () => ({
      name: 'chapel',
      rooms: [
        { name: 'porch', share: 0.6, front: true },
        { name: 'chapel', share: 5, front: true },
        { name: 'vestry', share: 0.8 },
      ],
    }),
  ],
  [
    /library/,
    (_, f) => ({
      name: floorName(f),
      rooms:
        f === 0
          ? [
              { name: 'entrance hall', share: 1, front: true },
              { name: 'reading room', share: 4, front: true },
              { name: 'lending desk', share: 1.2 },
              { name: 'stacks', share: 2.5, blind: true },
            ]
          : [
              { name: 'stacks', share: 4, blind: true },
              { name: 'reading room', share: 2.5, front: true },
            ],
    }),
  ],
  [
    /observatory|dome/,
    (_, f) => ({
      name: f === 0 ? 'ground floor' : 'telescope floor',
      rooms:
        f === 0
          ? [
              { name: 'entrance hall', share: 1, front: true },
              { name: 'library', share: 2, front: true },
              { name: 'computing room', share: 1.5 },
              { name: 'instrument store', share: 1, blind: true },
            ]
          : [{ name: 'telescope floor', share: 5, front: true }],
    }),
  ],
  [
    /water tower/,
    (_, f) => ({
      name: f === 0 ? 'ground floor' : 'tank level',
      rooms:
        f === 0
          ? [
              { name: 'valve room', share: 2, front: true },
              { name: 'store', share: 1, blind: true },
            ]
          : [{ name: 'tank room', share: 4, blind: true }],
    }),
  ],
  [
    /barrack/,
    (a, f) => ({
      name: floorName(f),
      rooms: [
        { name: 'passage', share: 0.8 },
        ...numbered('barrack room', Math.max(2, Math.round(a / 60)), 2.5, { front: true }),
        { name: 'sergeant’s room', share: 0.8 },
        { name: 'ablutions', share: 0.8, blind: true },
      ],
    }),
  ],
  [
    /great hall|central hall/,
    (_, f) => ({
      name: floorName(f),
      rooms:
        f === 0
          ? [
              { name: 'lobby', share: 1, front: true },
              { name: 'hall', share: 6, front: true },
              { name: 'offices', share: 1.5 },
              { name: 'store', share: 0.8, blind: true },
            ]
          : [
              { name: 'gallery', share: 3, front: true },
              { name: 'offices', share: 1.5 },
            ],
    }),
  ],
];

const byKind: Record<string, (areaM2: number, floor: number) => FloorProgramme> = {
  warehouse: (a, f) =>
    f === 0
      ? {
          name: 'ground floor',
          rooms: [
            ...numbered('bay', Math.max(1, Math.min(6, Math.round(a / 200))), 3, { front: true }),
            { name: 'loading dock', share: 1.2, front: true },
            { name: 'office', share: 0.8, front: true },
            { name: 'bonded store', share: 1, blind: true },
          ],
        }
      : {
          name: floorName(f),
          rooms: [
            ...numbered('upper bay', Math.max(1, Math.min(4, Math.round(a / 250))), 3, { front: true }),
            { name: 'hoist', share: 0.4, blind: true },
            { name: 'foreman’s office', share: 0.6 },
          ],
        },
  shed: (_, f) => workshop('shed floor', f, [{ name: 'stores', share: 1, blind: true }]),
  hall: (_, f) => workshop('hall floor', f, [{ name: 'stores', share: 1, blind: true }]),
  hangar: (a, f) => byName.find(([re]) => re.test('hangar'))![1](a, f, 1925),
  terminal: (a, f) => byName.find(([re]) => re.test('terminal'))![1](a, f, 1925),
  chapel: (a, f) => byName.find(([re]) => re.test('chapel'))![1](a, f, 1925),
  dome: (a, f) => byName.find(([re]) => re.test('dome'))![1](a, f, 1925),
  wheelhouse: (a, f) => byName.find(([re]) => re.test('wheel house'))![1](a, f, 1925),
  gate: (a, f) => byName.find(([re]) => re.test('gatehouse'))![1](a, f, 1925),
  tower: (_, f) => ({
    name: f === 0 ? 'ground floor' : `stage ${f + 1}`,
    rooms: [
      { name: f === 0 ? 'entrance' : 'chamber', share: 3, front: true },
      { name: 'stair', share: 0.6, blind: true },
    ],
  }),
  building: (a, f) => offices(a, f, 'manager’s office'),
};

/** Programme for one floor of a facility part; `label` is the part's display name. */
export function facilityProgramme(
  kind: string,
  label: string | undefined,
  floor: number,
  areaM2: number,
  year: number,
): FloorProgramme {
  const name = (label ?? '').toLowerCase();
  for (const [re, make] of byName) if (name && re.test(name)) return make(areaM2, floor, year);
  return (byKind[kind] ?? byKind.building!)(areaM2, floor);
}
