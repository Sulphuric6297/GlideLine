// Example course files, to download from the help guide and fill in: one hole in a made-up park with
// two tees, two pins, a bend and two layouts, in each format that can hold all of it.

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
