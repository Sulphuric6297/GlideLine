// Where Denmark is: Jutland and the islands inside a rough outline along the borders (the land
// border with Germany, the Flensburg Fjord, the Fehmarn Belt, the Øresund, the Kattegat), and
// Bornholm in a box. Good to a mile or two: Flensburg, Sylt, Fehmarn, Helsingborg, Malmö and
// Gothenburg are outside. Kept apart from the Danish maps themselves (denmark.ts), so a quick "is
// it in Denmark?" pulls nothing else in.
import type { GeoBounds } from "./core";

/** Rough boxes over Denmark (what a photo service covers; they reach over the borders). */
export const DK_REGIONS: GeoBounds[] = [
  { west: 8.0, south: 54.55, east: 12.8, north: 57.8 },
  { west: 14.65, south: 54.95, east: 15.2, north: 55.32 }
];

/** Jutland and the islands, [lon, lat] round the borders. */
const MAINLAND: [number, number][] = [
  [7.9, 55.07], [7.9, 57.0], [8.5, 57.3], [9.8, 57.7], [10.75, 57.85], [10.85, 57.6], [11.35, 57.45], [11.35, 57.1],
  [12.0, 56.9], [12.0, 56.45], [12.3, 56.3], [12.66, 56.07], [12.66, 55.9], [12.92, 55.63], [12.75, 55.3], [12.8, 54.9],
  [12.2, 54.5], [11.3, 54.55], [10.9, 54.6], [10.7, 54.68], [10.2, 54.78], [9.95, 54.82], [9.6, 54.86], [9.45, 54.83],
  [9.3, 54.8], [9.0, 54.87], [8.65, 54.91], [8.55, 55.07]
];
const BORNHOLM = DK_REGIONS[1];
const inside = (lon: number, lat: number) => {
  let c = false;
  for (let i = 0, j = MAINLAND.length - 1; i < MAINLAND.length; j = i++) {
    const [xi, yi] = MAINLAND[i], [xj, yj] = MAINLAND[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
/** Whether a site (by its middle) is in Denmark. */
export const inDenmark = (b: GeoBounds) => {
  const lon = (b.west + b.east) / 2, lat = (b.north + b.south) / 2;
  return inside(lon, lat) || (lon > BORNHOLM.west && lon < BORNHOLM.east && lat > BORNHOLM.south && lat < BORNHOLM.north);
};
