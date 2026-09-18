/**
 * Room programmes: what a building of a given use contains on each floor,
 * as names with area shares. The planner cuts the footprint to these shares;
 * a `front` room takes the street side and the door.
 */
import { facilityProgramme } from './facility.js';

export interface RoomSpec {
  name: string;
  share: number;
  front?: boolean;
  /** No windows (stores, cells, strongrooms). */
  blind?: boolean;
}

export interface FloorProgramme {
  name: string;
  rooms: RoomSpec[];
}

const residentialGround = (areaM2: number, year: number): RoomSpec[] => {
  const rooms: RoomSpec[] = [
    { name: 'parlour', share: 3, front: true },
    { name: 'kitchen', share: 2.2 },
  ];
  if (areaM2 > 60) rooms.push({ name: 'dining room', share: 2 });
  if (areaM2 > 95 && year < 1950) rooms.push({ name: 'scullery', share: 1 });
  if (areaM2 > 95) rooms.push({ name: 'study', share: 1.4 });
  if (areaM2 > 140) rooms.push({ name: 'drawing room', share: 2.4, front: true });
  if (year >= 1900 && areaM2 > 80) rooms.push({ name: 'bathroom', share: 0.8, blind: true });
  return rooms;
};

const residentialUpper = (areaM2: number, year: number, floor: number): RoomSpec[] => {
  const n = Math.max(1, Math.min(6, Math.round(areaM2 / 24)));
  const rooms: RoomSpec[] = [];
  for (let i = 0; i < n; i++)
    rooms.push({ name: i === 0 ? 'front bedroom' : `bedroom ${i + 1}`, share: 2, front: i === 0 });
  if (year >= 1890) rooms.push({ name: 'bathroom', share: 0.8, blind: true });
  if (areaM2 > 70 && floor === 1) rooms.push({ name: 'box room', share: 0.7 });
  return rooms;
};

const bedrooms = (count: number, prefix: string): RoomSpec[] =>
  Array.from({ length: count }, (_, i) => ({ name: `${prefix} ${i + 1}`, share: 1.4, front: i === 0 }));

/** Programme for one floor (0 = ground). */
export function programmeFor(
  use: string,
  kind: string,
  floor: number,
  floors: number,
  areaM2: number,
  year: number,
  label?: string,
): FloorProgramme {
  if (use === 'facility') return facilityProgramme(kind, label, floor, areaM2, year);
  const upper = floor > 0;
  const living = (): FloorProgramme =>
    upper
      ? { name: `floor ${floor + 1}`, rooms: residentialUpper(areaM2, year, floor) }
      : { name: 'ground floor', rooms: residentialGround(areaM2, year) };
  switch (use) {
    case 'church':
    case 'chapel':
    case 'cathedral':
      return {
        name: 'nave level',
        rooms: [
          { name: 'porch', share: 0.6, front: true },
          { name: 'nave', share: 6, front: true },
          { name: use === 'chapel' ? 'sanctuary' : 'chancel', share: 1.6 },
          { name: 'vestry', share: 0.8 },
        ],
      };
    case 'inn':
    case 'tavern':
    case 'pub':
      return upper
        ? {
            name: `floor ${floor + 1}`,
            rooms: [
              { name: 'passage', share: 0.8 },
              ...bedrooms(Math.max(2, Math.round(areaM2 / 18)), 'guest room'),
            ],
          }
        : {
            name: 'ground floor',
            rooms: [
              { name: use === 'pub' ? 'public bar' : 'taproom', share: 3, front: true },
              { name: use === 'pub' ? 'saloon bar' : 'parlour', share: 1.8, front: true },
              { name: 'kitchen', share: 1.4 },
              { name: 'cellar stair', share: 0.5, blind: true },
              { name: 'back room', share: 1 },
            ],
          };
    case 'hotel':
    case 'boardingHouse':
      return upper
        ? {
            name: `floor ${floor + 1}`,
            rooms: [
              { name: 'corridor', share: 1 },
              ...bedrooms(Math.max(2, Math.round(areaM2 / 16)), use === 'hotel' ? 'room' : 'lodger’s room'),
            ],
          }
        : {
            name: 'ground floor',
            rooms: [
              { name: use === 'hotel' ? 'lobby' : 'front hall', share: 2, front: true },
              { name: 'dining room', share: 2.4, front: true },
              { name: 'lounge', share: 1.8 },
              { name: 'kitchen', share: 1.5 },
              { name: 'office', share: 0.8 },
              { name: 'store', share: 0.6, blind: true },
            ],
          };
    case 'bank':
      return upper
        ? {
            name: `floor ${floor + 1}`,
            rooms: [
              { name: 'corridor', share: 0.8 },
              { name: 'manager’s office', share: 1.5, front: true },
              { name: 'clerks’ room', share: 2 },
              { name: 'records', share: 1, blind: true },
            ],
          }
        : {
            name: 'ground floor',
            rooms: [
              { name: 'banking hall', share: 4, front: true },
              { name: 'manager’s office', share: 1.2 },
              { name: 'strongroom', share: 0.8, blind: true },
              { name: 'clerks’ room', share: 1.4 },
            ],
          };
    case 'police':
      return upper
        ? {
            name: `floor ${floor + 1}`,
            rooms: [
              { name: 'corridor', share: 0.8 },
              { name: 'inspector’s office', share: 1.4, front: true },
              { name: 'detectives', share: 1.6 },
              { name: 'records', share: 1, blind: true },
            ],
          }
        : {
            name: 'ground floor',
            rooms: [
              { name: 'charge room', share: 2.5, front: true },
              { name: 'sergeant’s office', share: 1.2 },
              { name: 'cell 1', share: 0.5, blind: true },
              { name: 'cell 2', share: 0.5, blind: true },
              { name: 'evidence store', share: 0.7, blind: true },
            ],
          };
    case 'school':
      return {
        name: upper ? `floor ${floor + 1}` : 'ground floor',
        rooms: [
          { name: 'corridor', share: 1 },
          ...Array.from({ length: Math.max(2, Math.round(areaM2 / 50)) }, (_, i) => ({
            name: `classroom ${i + 1 + (upper ? 3 : 0)}`,
            share: 2,
            front: i === 0,
          })),
          ...(upper
            ? []
            : [
                { name: 'head’s office', share: 0.8 },
                { name: 'hall', share: 3 },
              ]),
        ],
      };
    case 'library':
      return {
        name: upper ? `floor ${floor + 1}` : 'ground floor',
        rooms: upper
          ? [
              { name: 'stacks', share: 4, blind: true },
              { name: 'reading room', share: 2.5, front: true },
              { name: 'archive', share: 1.2, blind: true },
            ]
          : [
              { name: 'entrance hall', share: 1, front: true },
              { name: 'reading room', share: 4, front: true },
              { name: 'lending desk', share: 1.2 },
              { name: 'stacks', share: 2.5, blind: true },
              { name: 'librarian’s office', share: 0.8 },
            ],
      };
    case 'theatre':
    case 'cinema':
      return upper
        ? {
            name: use === 'cinema' ? 'projection level' : 'circle level',
            rooms: [
              { name: use === 'cinema' ? 'projection room' : 'circle', share: 3, front: true },
              { name: 'office', share: 1 },
              { name: 'store', share: 0.8, blind: true },
            ],
          }
        : {
            name: 'ground floor',
            rooms: [
              { name: 'foyer', share: 1.5, front: true },
              { name: 'auditorium', share: 6 },
              { name: use === 'cinema' ? 'screen wall' : 'stage', share: 1.5 },
              { name: 'box office', share: 0.5, front: true },
              { name: 'dressing room', share: 0.8 },
            ],
          };
    case 'lodge':
      return {
        name: upper ? `floor ${floor + 1}` : 'ground floor',
        rooms: upper
          ? [
              { name: 'lodge room', share: 4, front: true },
              { name: 'anteroom', share: 1 },
              { name: 'regalia store', share: 0.8, blind: true },
            ]
          : [
              { name: 'entrance hall', share: 1, front: true },
              { name: 'dining room', share: 2.5, front: true },
              { name: 'kitchen', share: 1.2 },
              { name: 'steward’s room', share: 0.8 },
            ],
      };
    case 'funeral':
      return upper
        ? living()
        : {
            name: 'ground floor',
            rooms: [
              { name: 'reception', share: 1.5, front: true },
              { name: 'chapel of rest', share: 2, front: true },
              { name: 'workroom', share: 1.6, blind: true },
              { name: 'coffin store', share: 1, blind: true },
              { name: 'office', share: 0.8 },
            ],
          };
    case 'doctor':
    case 'lawyer':
    case 'office':
    case 'telegraph':
    case 'telephone':
    case 'post':
      return {
        name: upper ? `floor ${floor + 1}` : 'ground floor',
        rooms: upper
          ? [
              { name: 'corridor', share: 0.8 },
              ...Array.from({ length: Math.max(2, Math.round(areaM2 / 30)) }, (_, i) => ({
                name: `office ${i + 1}`,
                share: 1.6,
                front: i === 0,
              })),
              { name: 'store', share: 0.6, blind: true },
            ]
          : [
              {
                name:
                  use === 'post'
                    ? 'counter hall'
                    : use === 'telephone'
                      ? 'switchboard room'
                      : use === 'telegraph'
                        ? 'telegraph office'
                        : 'waiting room',
                share: 2.5,
                front: true,
              },
              {
                name:
                  use === 'doctor'
                    ? 'consulting room'
                    : use === 'lawyer'
                      ? 'partner’s office'
                      : 'manager’s office',
                share: 1.6,
                front: true,
              },
              {
                name:
                  use === 'post' ? 'sorting room' : use === 'telephone' ? 'apparatus room' : 'clerks’ room',
                share: 1.8,
              },
              { name: 'store', share: 0.7, blind: true },
            ],
      };
    case 'warehouse':
    case 'workshop':
    case 'smith':
    case 'garage':
    case 'petrol':
      return {
        name: upper ? `floor ${floor + 1}` : 'ground floor',
        rooms: upper
          ? [
              { name: 'upper store', share: 5, blind: false },
              { name: 'office', share: 1, front: true },
              { name: 'hoist', share: 0.4, blind: true },
            ]
          : [
              {
                name:
                  use === 'smith'
                    ? 'forge'
                    : use === 'garage' || use === 'petrol'
                      ? 'workshop bay'
                      : use === 'workshop'
                        ? 'workshop'
                        : 'warehouse floor',
                share: 6,
                front: true,
              },
              { name: 'office', share: 1, front: true },
              { name: 'stores', share: 1.2, blind: true },
            ],
      };
    case 'supermarket':
    case 'department':
      return {
        name: upper ? `floor ${floor + 1}` : 'ground floor',
        rooms: upper
          ? [
              { name: 'sales floor', share: 5, front: true },
              { name: 'stock room', share: 1.5, blind: true },
              { name: 'staff room', share: 0.8 },
            ]
          : [
              { name: 'sales floor', share: 6, front: true },
              { name: 'stock room', share: 2, blind: true },
              { name: 'manager’s office', share: 0.8 },
              { name: 'loading', share: 0.8, blind: true },
            ],
      };
    case 'residential':
      if (kind === 'tenement' || kind === 'apartment' || kind === 'tower') {
        const flats = Math.max(1, Math.round(areaM2 / 70));
        const rooms: RoomSpec[] = [{ name: 'stair hall', share: 1 }];
        for (let f = 0; f < flats; f++) {
          const letter = String.fromCharCode(65 + ((floor * flats + f) % 26));
          rooms.push(
            { name: `flat ${letter} living room`, share: 1.8, front: f === 0 },
            { name: `flat ${letter} bedroom`, share: 1.4 },
            { name: `flat ${letter} kitchen`, share: 0.9 },
          );
        }
        return { name: upper ? `floor ${floor + 1}` : 'ground floor', rooms };
      }
      return living();
    default:
      // Shops and other trades: the shop below, living above.
      if (upper) return living();
      return {
        name: 'ground floor',
        rooms: [
          { name: shopName(use), share: 3.5, front: true },
          { name: 'back room', share: 1.4 },
          { name: 'store', share: 1, blind: true },
          ...(areaM2 > 70 ? [{ name: 'kitchen', share: 1 }] : []),
        ],
      };
  }
}

function shopName(use: string): string {
  const names: Record<string, string> = {
    cornerShop: 'shop floor',
    generalStore: 'shop floor',
    baker: 'bakery shop',
    butcher: 'butcher’s shop',
    pharmacy: 'dispensary',
    cafe: 'café',
    shop: 'shop floor',
  };
  return names[use] ?? 'shop floor';
}

/** How many floors of a building get a plan (churches are one hall; tall towers cap at the first eight). */
export function plannedFloors(use: string, floors: number): number {
  if (['church', 'chapel', 'cathedral'].includes(use)) return 1;
  return Math.max(1, Math.min(8, floors));
}
