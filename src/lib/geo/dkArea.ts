// Where Denmark is (rough boxes): Jutland and the islands, and Bornholm. Kept apart from the
// Danish maps themselves (denmark.ts), so a quick "is it in Denmark?" pulls nothing else in.
import type { GeoBounds } from "./core";

export const DK_REGIONS: GeoBounds[] = [
  { west: 8.0, south: 54.55, east: 12.8, north: 57.8 },
  { west: 14.65, south: 54.95, east: 15.2, north: 55.32 }
];
export const inDenmark = (b: GeoBounds) => DK_REGIONS.some(r => b.west < r.east && b.east > r.west && b.south < r.north && b.north > r.south);
