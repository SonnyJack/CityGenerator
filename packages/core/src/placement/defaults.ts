import type { SettlementSite } from '../settlement/siting.js';
import type { FeatureSize, PlacementRequest } from './types.js';

/**
 * Facilities a settlement gets by default, from its kind, population and the
 * year. Explicit requests in the spec are added on top; `remove` overrides
 * drop any of these by id (`${settlement}:${type}`).
 */
export function defaultRequests(site: SettlementSite, year: number): PlacementRequest[] {
  const out: PlacementRequest[] = [];
  const pop = site.population;
  const kind = site.kind;
  const sizeFor = (small: number, large: number): FeatureSize =>
    pop < small ? 'small' : pop >= large ? 'large' : 'medium';
  const add = (type: string, size: FeatureSize, params?: Record<string, unknown>) =>
    out.push({ id: `${site.id}:${type}`, type, size, settlement: site.id, ...(params ? { params } : {}) });

  const coastalCity = site.coastal && pop >= 5000;
  if (kind === 'portTown' || (coastalCity && pop >= 25_000)) add('port', sizeFor(8000, 60_000));
  if (
    kind === 'fishingVillage' ||
    (kind === 'portTown' && pop < 30_000) ||
    (site.coastal && kind === 'resort' && year < 1950)
  )
    add('harbour.fishing', sizeFor(500, 5000));
  if (kind === 'resort' && site.coastal && year >= 1950) add('harbour.marina', sizeFor(1500, 8000));
  if ((kind === 'portTown' && pop >= 6000 && year >= 1700) || (coastalCity && pop >= 60_000))
    add('shipyard', sizeFor(10_000, 80_000));

  if (kind === 'millTown' || (site.riverside && year < 1900 && pop >= 2000))
    add('industry.mill', sizeFor(1500, 5000));
  if (kind === 'miningTown' || kind === 'industrialSatellite' || (pop >= 20_000 && year >= 1830))
    add('industry.heavy', sizeFor(5000, 80_000));
  if (pop >= 8000 && year >= 1815 && year <= 1970) add('industry.gasworks', sizeFor(15_000, 100_000));
  if (pop >= 40_000 && year >= 1890) add('industry.power', sizeFor(80_000, 300_000));
  if (site.coastal && pop >= 60_000 && year >= 1920) add('industry.refinery', sizeFor(100_000, 400_000));
  if (pop >= 30_000 && year >= 1965) add('industry.logistics', sizeFor(60_000, 250_000));
  if (pop >= 3000 && year >= 1500 && year < 2100) add('industry.brewery', sizeFor(10_000, 100_000));
  if (site.riverside && pop >= 1500 && year < 1950) add('industry.tannery', sizeFor(5000, 30_000));

  if (kind === 'universityTown' || (pop >= 80_000 && year >= 1800))
    add('institution.campus', sizeFor(20_000, 150_000));
  if (pop >= 6000 && year >= 1750) add('institution.hospital', sizeFor(20_000, 120_000));
  if (pop >= 25_000 && year >= 1810 && year <= 1990) add('institution.asylum', sizeFor(60_000, 200_000));
  if (pop >= 40_000 && year >= 1790) add('institution.prison', sizeFor(100_000, 300_000));
  if (pop >= 100_000 && year >= 1650) add('institution.military', sizeFor(150_000, 500_000));
  if (pop >= 1500) add('institution.cemetery', sizeFor(5000, 60_000));
  if (pop >= 12_000 && year >= 1810) add('institution.waterworks', sizeFor(30_000, 150_000));
  if ((kind === 'universityTown' || pop >= 150_000) && year >= 1700) add('institution.observatory', 'medium');
  if (pop >= 60_000 && year >= 1930) add('transport.airport', sizeFor(150_000, 500_000));
  return out;
}
