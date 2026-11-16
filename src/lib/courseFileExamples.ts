// Example course files, to download from the help guide and fill in: one hole in a made-up park with
// two tees, two pins, a bend and two layouts, in every format Holes from a GPS file reads. GPX has
// names only, so its example has the points and the line, and the rest is left out.

export const EXAMPLE_CSV = [
  "hole,kind,tee,pin,surface,par,hole_name,hole_notes,model,layout,lat,lon",
  "1,tee,Blue,,Turf,4,The Long Way,OB left of the path.,,,39.78021,-89.68112",
  "1,tee,Red,,Natural,3,,,,,39.78034,-89.68087",
  "1,basket,,A,,,,,Springfield 24,,39.78102,-89.67990",
  "1,basket,,B,,,,,Springfield 24,,39.78085,-89.67961",
  "1,bend,Blue,,,,,,,,39.78040,-89.68055",
  ",layout,Blue,A,,,,,,Long,,",
  ",layout,Red,B,,,,,,Short,,",
  ""
].join("\n");

const point = (lon: number, lat: number, properties: Record<string, unknown>) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties });
const line = (coordinates: number[][], properties: Record<string, unknown>) => ({ type: "Feature", geometry: { type: "LineString", coordinates }, properties });

export const EXAMPLE_GEOJSON = JSON.stringify({
  type: "FeatureCollection",
  name: "Springfield Park",
  layouts: [{ layout: "Long", tee: "Blue", pin: "A" }, { layout: "Short", tee: "Red", pin: "B" }],
  features: [
    point(-89.68112, 39.78021, { kind: "tee", hole: 1, tee: "Blue", surface: "Turf" }),
    point(-89.68087, 39.78034, { kind: "tee", hole: 1, tee: "Red", surface: "Natural" }),
    point(-89.6799, 39.78102, { kind: "basket", hole: 1, pin: "A", model: "Springfield 24" }),
    point(-89.67961, 39.78085, { kind: "basket", hole: 1, pin: "B", model: "Springfield 24" }),
    line([[-89.68112, 39.78021], [-89.68055, 39.7804], [-89.6799, 39.78102]], { kind: "hole", hole: 1, tee: "Blue", par: 4, name: "The Long Way", notes: "OB left of the path." }),
    line([[-89.68087, 39.78034], [-89.6799, 39.78102]], { kind: "hole", hole: 1, tee: "Red", par: 3 })
  ]
}, null, 2) + "\n";

const data = (d: Record<string, string | number>) => `<ExtendedData>${Object.entries(d).map(([k, v]) => `<Data name="${k}"><value>${v}</value></Data>`).join("")}</ExtendedData>`;
const placemark = (name: string, d: Record<string, string | number>, geometry = "") => `    <Placemark><name>${name}</name>${data(d)}${geometry}</Placemark>`;
const kmlPoint = (lon: number, lat: number) => `<Point><coordinates>${lon},${lat}</coordinates></Point>`;
const kmlLine = (c: number[][]) => `<LineString><coordinates>${c.map(([lon, lat]) => `${lon},${lat}`).join(" ")}</coordinates></LineString>`;

export const EXAMPLE_KML = [
  `<?xml version="1.0" encoding="UTF-8"?>`,
  `<kml xmlns="http://www.opengis.net/kml/2.2">`,
  `  <Document>`,
  `    <name>Springfield Park</name>`,
  placemark("Hole 1 Blue tee", { kind: "tee", hole: 1, tee: "Blue", surface: "Turf" }, kmlPoint(-89.68112, 39.78021)),
  placemark("Hole 1 Red tee", { kind: "tee", hole: 1, tee: "Red", surface: "Natural" }, kmlPoint(-89.68087, 39.78034)),
  placemark("Hole 1 basket A", { kind: "basket", hole: 1, pin: "A", model: "Springfield 24" }, kmlPoint(-89.6799, 39.78102)),
  placemark("Hole 1 basket B", { kind: "basket", hole: 1, pin: "B", model: "Springfield 24" }, kmlPoint(-89.67961, 39.78085)),
  placemark("The Long Way", { kind: "hole", hole: 1, tee: "Blue", par: 4, notes: "OB left of the path." }, kmlLine([[-89.68112, 39.78021], [-89.68055, 39.7804], [-89.6799, 39.78102]])),
  placemark("Hole 1 Red", { kind: "hole", hole: 1, tee: "Red", par: 3 }, kmlLine([[-89.68087, 39.78034], [-89.6799, 39.78102]])),
  placemark("Long", { kind: "layout", tee: "Blue", pin: "A" }),
  placemark("Short", { kind: "layout", tee: "Red", pin: "B" }),
  `  </Document>`,
  `</kml>`,
  ""
].join("\n");

const wpt = (lon: number, lat: number, name: string) => `  <wpt lat="${lat}" lon="${lon}"><name>${name}</name></wpt>`;

export const EXAMPLE_GPX = [
  `<?xml version="1.0" encoding="UTF-8"?>`,
  `<gpx version="1.1" creator="GlideLine Studio" xmlns="http://www.topografix.com/GPX/1/1">`,
  `  <metadata><name>Springfield Park</name></metadata>`,
  wpt(-89.68112, 39.78021, "Hole 1 Blue tee"),
  wpt(-89.68087, 39.78034, "Hole 1 Red tee"),
  wpt(-89.6799, 39.78102, "Hole 1 basket A"),
  wpt(-89.67961, 39.78085, "Hole 1 basket B"),
  `  <rte><name>Hole 1 Blue</name>${[[-89.68112, 39.78021], [-89.68055, 39.7804], [-89.6799, 39.78102]].map(([lon, lat]) => `<rtept lat="${lat}" lon="${lon}"/>`).join("")}</rte>`,
  `</gpx>`,
  ""
].join("\n");
