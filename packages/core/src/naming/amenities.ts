import type { Rng } from '../random/rng.js';
import type { WardId } from '../settlement/wards.js';
import type { CulturePack } from './schema.js';

/**
 * Amenities and points of interest by era (DESIGN Phase 7): each has a
 * window of years, the wards it favours and a rate per hundred buildings.
 * A building's use is drawn deterministically from its own seed.
 */
export interface Amenity {
  id: string;
  label: string;
  years: [number, number];
  /** Rate per 100 buildings in favoured wards; other wards get a tenth. */
  rate: number;
  wards: WardId[];
  /** Trade word for business names. */
  trade: string;
  category:
    'shop' | 'pub' | 'civic' | 'religious' | 'service' | 'lodging' | 'entertainment' | 'industry' | 'office';
}

const commercial: WardId[] = ['market', 'merchant', 'cbd', 'retailStrip', 'craftsmen', 'shophouse' as WardId];
const residential: WardId[] = [
  'rowhouse',
  'tenement',
  'streetcarSuburb',
  'gardenSuburb',
  'suburb',
  'culDeSac',
  'apartment',
  'towerEstate',
  'patriciate',
  'slum',
  'craftsmen',
];

export const AMENITIES: Amenity[] = [
  {
    id: 'church',
    label: 'church',
    years: [1100, 2100],
    rate: 1.2,
    wards: ['cathedral', 'market', 'merchant', 'patriciate', 'rowhouse', 'streetcarSuburb', 'suburb'],
    trade: 'church',
    category: 'religious',
  },
  {
    id: 'chapel',
    label: 'chapel',
    years: [1100, 2100],
    rate: 0.8,
    wards: ['craftsmen', 'slum', 'tenement', 'rowhouse', 'gardenSuburb'],
    trade: 'chapel',
    category: 'religious',
  },
  {
    id: 'inn',
    label: 'inn',
    years: [1100, 1900],
    rate: 2,
    wards: ['market', 'merchant', 'gate', 'craftsmen'],
    trade: 'Inn',
    category: 'lodging',
  },
  {
    id: 'tavern',
    label: 'tavern',
    years: [1100, 1850],
    rate: 3,
    wards: ['market', 'craftsmen', 'slum', 'merchant'],
    trade: 'Tavern',
    category: 'pub',
  },
  {
    id: 'pub',
    label: 'public house',
    years: [1780, 2100],
    rate: 3,
    wards: ['market', 'craftsmen', 'rowhouse', 'tenement', 'retailStrip', 'streetcarSuburb', 'cbd'],
    trade: 'Arms',
    category: 'pub',
  },
  {
    id: 'cornerShop',
    label: 'corner shop',
    years: [1800, 2100],
    rate: 4,
    wards: ['rowhouse', 'tenement', 'streetcarSuburb', 'suburb', 'apartment', 'craftsmen'],
    trade: 'Stores',
    category: 'shop',
  },
  {
    id: 'generalStore',
    label: 'general store',
    years: [1650, 1960],
    rate: 2,
    wards: ['market', 'merchant', 'craftsmen', 'retailStrip'],
    trade: 'General Store',
    category: 'shop',
  },
  {
    id: 'baker',
    label: 'bakery',
    years: [1100, 2100],
    rate: 2,
    wards: commercial,
    trade: 'Bakery',
    category: 'shop',
  },
  {
    id: 'butcher',
    label: 'butcher',
    years: [1100, 2100],
    rate: 1.5,
    wards: commercial,
    trade: 'Butcher',
    category: 'shop',
  },
  {
    id: 'smith',
    label: 'smithy',
    years: [1100, 1920],
    rate: 1.5,
    wards: ['craftsmen', 'gate', 'market'],
    trade: 'Forge',
    category: 'industry',
  },
  {
    id: 'pharmacy',
    label: 'pharmacy',
    years: [1700, 2100],
    rate: 1,
    wards: commercial,
    trade: 'Pharmacy',
    category: 'shop',
  },
  {
    id: 'school',
    label: 'school',
    years: [1600, 2100],
    rate: 0.8,
    wards: [...residential, 'market'],
    trade: 'School',
    category: 'civic',
  },
  {
    id: 'police',
    label: 'police station',
    years: [1830, 2100],
    rate: 0.3,
    wards: ['market', 'cbd', 'merchant', 'rowhouse'],
    trade: 'Police Station',
    category: 'civic',
  },
  {
    id: 'fire',
    label: 'fire station',
    years: [1800, 2100],
    rate: 0.3,
    wards: ['market', 'cbd', 'craftsmen', 'rowhouse', 'warehouse'],
    trade: 'Fire Station',
    category: 'civic',
  },
  {
    id: 'post',
    label: 'post office',
    years: [1650, 2100],
    rate: 0.4,
    wards: ['market', 'cbd', 'merchant', 'retailStrip'],
    trade: 'Post Office',
    category: 'civic',
  },
  {
    id: 'bank',
    label: 'bank',
    years: [1700, 2100],
    rate: 0.8,
    wards: ['market', 'cbd', 'merchant'],
    trade: 'Bank',
    category: 'office',
  },
  {
    id: 'telegraph',
    label: 'telegraph office',
    years: [1850, 1950],
    rate: 0.2,
    wards: ['market', 'cbd', 'merchant'],
    trade: 'Telegraph Office',
    category: 'civic',
  },
  {
    id: 'telephone',
    label: 'telephone exchange',
    years: [1880, 1990],
    rate: 0.2,
    wards: ['cbd', 'market', 'rowhouse'],
    trade: 'Telephone Exchange',
    category: 'civic',
  },
  {
    id: 'cinema',
    label: 'cinema',
    years: [1908, 2100],
    rate: 0.4,
    wards: ['cbd', 'retailStrip', 'market', 'streetcarSuburb'],
    trade: 'Picture House',
    category: 'entertainment',
  },
  {
    id: 'theatre',
    label: 'theatre',
    years: [1600, 2100],
    rate: 0.3,
    wards: ['market', 'cbd', 'merchant', 'patriciate'],
    trade: 'Theatre',
    category: 'entertainment',
  },
  {
    id: 'boardingHouse',
    label: 'boarding house',
    years: [1800, 1970],
    rate: 1.5,
    wards: ['rowhouse', 'tenement', 'slum', 'craftsmen', 'merchant'],
    trade: 'Boarding House',
    category: 'lodging',
  },
  {
    id: 'hotel',
    label: 'hotel',
    years: [1820, 2100],
    rate: 0.6,
    wards: ['cbd', 'market', 'merchant', 'retailStrip'],
    trade: 'Hotel',
    category: 'lodging',
  },
  {
    id: 'funeral',
    label: 'funeral parlour',
    years: [1850, 2100],
    rate: 0.3,
    wards: ['rowhouse', 'retailStrip', 'craftsmen', 'streetcarSuburb'],
    trade: 'Funeral Parlour',
    category: 'service',
  },
  {
    id: 'doctor',
    label: "doctor's surgery",
    years: [1700, 2100],
    rate: 0.6,
    wards: ['patriciate', 'merchant', 'rowhouse', 'gardenSuburb', 'cbd'],
    trade: 'Surgery',
    category: 'service',
  },
  {
    id: 'lawyer',
    label: "solicitor's office",
    years: [1700, 2100],
    rate: 0.5,
    wards: ['cbd', 'market', 'merchant', 'patriciate'],
    trade: 'Solicitors',
    category: 'office',
  },
  {
    id: 'garage',
    label: 'garage',
    years: [1905, 2100],
    rate: 0.8,
    wards: ['retailStrip', 'suburb', 'streetcarSuburb', 'warehouse', 'culDeSac'],
    trade: 'Motor Garage',
    category: 'service',
  },
  {
    id: 'warehouse',
    label: 'warehouse',
    years: [1600, 2100],
    rate: 3,
    wards: ['warehouse', 'merchant'],
    trade: 'Warehouse',
    category: 'industry',
  },
  {
    id: 'workshop',
    label: 'workshop',
    years: [1100, 2100],
    rate: 3,
    wards: ['craftsmen', 'warehouse', 'slum'],
    trade: 'Works',
    category: 'industry',
  },
  {
    id: 'office',
    label: 'offices',
    years: [1850, 2100],
    rate: 4,
    wards: ['cbd'],
    trade: 'Offices',
    category: 'office',
  },
  {
    id: 'department',
    label: 'department store',
    years: [1870, 2100],
    rate: 0.3,
    wards: ['cbd', 'retailStrip'],
    trade: 'Emporium',
    category: 'shop',
  },
  {
    id: 'cafe',
    label: 'café',
    years: [1700, 2100],
    rate: 1.2,
    wards: ['market', 'cbd', 'retailStrip', 'merchant'],
    trade: 'Café',
    category: 'pub',
  },
  {
    id: 'library',
    label: 'public library',
    years: [1850, 2100],
    rate: 0.15,
    wards: ['market', 'cbd', 'patriciate'],
    trade: 'Library',
    category: 'civic',
  },
  {
    id: 'lodge',
    label: 'lodge hall',
    years: [1750, 2100],
    rate: 0.25,
    wards: ['market', 'merchant', 'cbd', 'rowhouse'],
    trade: 'Lodge',
    category: 'civic',
  },
  {
    id: 'supermarket',
    label: 'supermarket',
    years: [1950, 2100],
    rate: 0.4,
    wards: ['retailStrip', 'suburb', 'culDeSac', 'apartment'],
    trade: 'Supermarket',
    category: 'shop',
  },
  {
    id: 'petrol',
    label: 'filling station',
    years: [1920, 2100],
    rate: 0.4,
    wards: ['retailStrip', 'suburb', 'culDeSac', 'warehouse'],
    trade: 'Filling Station',
    category: 'service',
  },
];

/** The amenity for a building, or null for a residence. */
export function amenityFor(rng: Rng, year: number, ward: WardId, kind: string): Amenity | null {
  // Some kinds are always businesses.
  const forced =
    kind === 'shop' ||
    kind === 'shophouse' ||
    kind === 'office' ||
    kind === 'warehouse' ||
    kind === 'workshop';
  const candidates = AMENITIES.filter((a) => year >= a.years[0] && year <= a.years[1]);
  const weights = candidates.map((a) => (a.wards.includes(ward) ? a.rate : a.rate * 0.1));
  const total = weights.reduce((a, b) => a + b, 0);
  const density =
    ward === 'cbd' || ward === 'retailStrip' || ward === 'market'
      ? 1
      : ward === 'merchant' || ward === 'craftsmen'
        ? 0.55
        : 0.2;
  // Probability that this building is an amenity at all.
  const p = forced ? 1 : Math.min(0.9, (total / 100) * density);
  if (!rng.chance(p)) return null;
  return rng.weighted(candidates, weights);
}

/** Building material from the culture's mix for the era band. */
export function materialFor(rng: Rng, year: number, pack: CulturePack, kind: string): string {
  const band =
    year < 1830
      ? pack.conventions.materials.preIndustrial
      : year < 1950
        ? pack.conventions.materials.industrial
        : pack.conventions.materials.modern;
  const entries = Object.entries(band);
  if (kind === 'keep' || kind === 'cathedral') return 'stone';
  if (kind === 'tower' || kind === 'apartment') return year >= 1950 ? 'concrete' : 'brick';
  return rng.weighted(
    entries.map(([m]) => m),
    entries.map(([, w]) => w),
  );
}
