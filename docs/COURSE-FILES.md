# Course files: what Holes from a GPS file reads

Holes from a GPS file brings a course's holes in from a file: every tee and basket in its real
place, each hole's bends, and whatever else the file says about the holes. This page lists what a
file can hold and how to write it so all of it comes in.

CSV, GeoJSON and KML can hold everything below (KML as each placemark's ExtendedData). GPX only
has names, so a GPX brings in tees, baskets and lines, and the rest comes from what each name says.

The help guide's Course file format has the same list, with these examples to download.

A GeoJSON exported from GlideLine Studio (Export, GPS and spreadsheets) is already in this format,
with a line for each layout and for each tee no layout plays, so a course exported and opened again
comes back with all of it.

## What comes in

| What | Where it goes |
|---|---|
| Tees, with their color | Each hole's tees, one of each color |
| A tee's surface | The tee pad's Tee surface |
| Baskets, with their pin position | Each hole's pins, A to D |
| A basket's model | The basket's Basket model |
| A line from a tee to its basket | The hole's bends, or that tee's own Bends |
| Par | The hole's par, or that tee's own Par from this tee |
| The hole's name and notes | The hole's Name and Notes and hole rules |
| Layouts | The course's layouts (which tee color and pin each one plays) |
| The course's name | The course's name, if it doesn't have one of its own yet |

## The properties

Keys can be in any case, and spaces work in place of underscores (a CSV's `Hole Name` column is
read as `hole_name`).

### Every point and line

| Key | Values | Notes |
|---|---|---|
| `kind` | `tee`, `basket`, `hole` | `hole` is a line from a tee to its basket. `layout` too (see each format below), and in a CSV, `bend` rows. |
| `hole` | `1` to `99` | The hole's number. |

### Tees

| Key | Values | Notes |
|---|---|---|
| `tee` | `Gold`, `Blue`, `White`, `Red`, `Green`, `Purple` | The tee's color. Without one, the longest tee gets the back color and the rest follow in the usual order. `long` and `short` work too. |
| `surface` | `Concrete`, `Turf`, `Rubber`, `Pavers`, `Gravel`, `Natural` | Everyday words work: `artificial turf`, `rubber mat`, `brick`, `dirt`, `grass` (dirt and grass are Natural, shown as Grass or dirt). Unset: Concrete. |

### Baskets

| Key | Values | Notes |
|---|---|---|
| `pin` | `A`, `B`, `C`, `D` | The pin position. `long` and `short` work too (short is A). Unset: A, then B and so on in the file's order. |
| `model` | Any text | The basket's maker and model, such as `Springfield 24`. |

### Lines and holes

| Key | Values | Notes |
|---|---|---|
| `tee` | A tee color | Which tee the line starts from. A hole can have a line from each tee. |
| `par` | `2` to `7` | That tee's par. On a tee's own point or row, that tee's par too. |
| `name` | Any text | On a hole's line: the hole's name, such as `The Long Way`. A name that only says the hole or tee (`Hole 3`, `Blue 3`) isn't used as one. |
| `notes` | Any text | On a hole's line: the hole's notes and rules. |
| `hole_name`, `hole_notes` | Any text | The same, on any point of the hole (in a CSV, any row). |

When a hole has a line from each tee, the back tee's line (gold, then blue, then white and so on)
gives the hole its bends and par. Any other tee whose line turns somewhere else keeps its own bends,
and one with a different par keeps its own par (a tee's Bends and Par from this tee).

### Layouts

| Key | Values | Notes |
|---|---|---|
| `layout` | Any text | The layout's name. |
| `tee` | A tee color | The tee color it plays. Unset: Blue. |
| `pin` | `A` to `D` | The pin it plays. Unset: A. |

A course that only has the layout every course starts with (Main) takes the file's layouts in its
place. Otherwise a layout of the same name gets the file's tee and pin, and the rest are added.

## GeoJSON

A FeatureCollection. Tees and baskets are Points and a hole's lines are LineStrings, from the tee
through each bend to the basket. The course's `name` and its `layouts` sit beside `features`.
Coordinates are longitude, then latitude, as GeoJSON always has them.

```json
{
  "type": "FeatureCollection",
  "name": "Springfield Park",
  "layouts": [
    { "layout": "Long", "tee": "Blue", "pin": "A" },
    { "layout": "Short", "tee": "Red", "pin": "B" }
  ],
  "features": [
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-89.68112, 39.78021] },
      "properties": { "kind": "tee", "hole": 1, "tee": "Blue", "surface": "Turf" } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-89.68087, 39.78034] },
      "properties": { "kind": "tee", "hole": 1, "tee": "Red", "surface": "Natural" } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-89.67990, 39.78102] },
      "properties": { "kind": "basket", "hole": 1, "pin": "A", "model": "Springfield 24" } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-89.67961, 39.78085] },
      "properties": { "kind": "basket", "hole": 1, "pin": "B", "model": "Springfield 24" } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [[-89.68112, 39.78021], [-89.68055, 39.78040], [-89.67990, 39.78102]] },
      "properties": { "kind": "hole", "hole": 1, "tee": "Blue", "par": 4, "name": "The Long Way", "notes": "OB left of the path." } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [[-89.68087, 39.78034], [-89.67990, 39.78102]] },
      "properties": { "kind": "hole", "hole": 1, "tee": "Red", "par": 3 } }
  ]
}
```

OpenStreetMap's own tags work as well (`disc_golf=tee`, `disc_golf=basket`, `disc_golf=hole`, with
the hole number in `ref`, such as `3` or `3A`), so an Overpass Turbo export opens as it is.

## CSV

One row a point, with `lat` and `lon` columns (`latitude` and `longitude` work too). Commas,
semicolons or tabs between the columns all work.

- A `bend` row is a point a hole's line turns at. Put them in order from the tee. With a `tee`
  color, they're that tee's line; without one, the hole's first tee's.
- A `layout` row has no `lat` and `lon`: just `layout`, `tee` and `pin`.

```csv
hole,kind,tee,pin,surface,par,hole_name,hole_notes,model,layout,lat,lon
1,tee,Blue,,Turf,4,The Long Way,OB left of the path.,,,39.78021,-89.68112
1,tee,Red,,Natural,3,,,,,39.78034,-89.68087
1,basket,,A,,,,,Springfield 24,,39.78102,-89.67990
1,basket,,B,,,,,Springfield 24,,39.78085,-89.67961
1,bend,Blue,,,,,,,,39.78040,-89.68055
,layout,Blue,A,,,,,,Long,,
,layout,Red,B,,,,,,Short,,
```

A row a hole works too: `tee_lat` and `tee_lon`, then `basket_lat` and `basket_lon` (more than one
pin as `basket_a_lat`, `basket_b_lat` and so on). The hole list GlideLine Studio exports reads back
this way, with its `name`, `notes`, `tee`, `par` and `basket_pin` columns.

## KML

Placemarks, each with its keys as ExtendedData. Tees and baskets are Points, and a hole's lines are
LineStrings (`kind` `hole`), from the tee through each bend to the basket. The line's placemark
name is the hole's name, as GeoJSON's `name` is. A layout is a placemark of `kind` `layout` with no
point or line, named for the layout. The Document's name is the course's. A KMZ is a zipped KML.

```xml
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Springfield Park</name>
    <Placemark><name>Hole 1 Blue tee</name>
      <ExtendedData><Data name="kind"><value>tee</value></Data><Data name="hole"><value>1</value></Data>
        <Data name="tee"><value>Blue</value></Data><Data name="surface"><value>Turf</value></Data></ExtendedData>
      <Point><coordinates>-89.68112,39.78021</coordinates></Point></Placemark>
    <Placemark><name>The Long Way</name>
      <ExtendedData><Data name="kind"><value>hole</value></Data><Data name="hole"><value>1</value></Data>
        <Data name="tee"><value>Blue</value></Data><Data name="par"><value>4</value></Data>
        <Data name="notes"><value>OB left of the path.</value></Data></ExtendedData>
      <LineString><coordinates>-89.68112,39.78021 -89.68055,39.7804 -89.6799,39.78102</coordinates></LineString></Placemark>
    <Placemark><name>Long</name>
      <ExtendedData><Data name="kind"><value>layout</value></Data><Data name="tee"><value>Blue</value></Data>
        <Data name="pin"><value>A</value></Data></ExtendedData></Placemark>
  </Document>
</kml>
```

The help guide's example KML has the whole hole: both tees, both baskets, both lines and both
layouts.

A KML without ExtendedData, such as one drawn in Google Earth, works from names: name each point
for what it is (`Hole 3 Tee`, `3T`, `Blue tee 3`, `Basket 3`, `3A`, `Pin 3 long`), or put a
hole's points in a folder named `Hole 3`.

## GPX

GPX has names only. Name each waypoint for what it is, as above, and a route or track named
`Hole 3` (or `Hole 3 Blue`) is that hole's line. The metadata's name is the course's. Surfaces,
models, par, the hole's name and notes, and layouts don't fit in a GPX, so set them in the app.

```xml
<gpx version="1.1" creator="GlideLine Studio" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Springfield Park</name></metadata>
  <wpt lat="39.78021" lon="-89.68112"><name>Hole 1 Blue tee</name></wpt>
  <wpt lat="39.78034" lon="-89.68087"><name>Hole 1 Red tee</name></wpt>
  <wpt lat="39.78102" lon="-89.6799"><name>Hole 1 basket A</name></wpt>
  <wpt lat="39.78085" lon="-89.67961"><name>Hole 1 basket B</name></wpt>
  <rte><name>Hole 1 Blue</name><rtept lat="39.78021" lon="-89.68112"/><rtept lat="39.7804" lon="-89.68055"/><rtept lat="39.78102" lon="-89.6799"/></rte>
</gpx>
```

## What doesn't come in

- Mandos, drop zones, OB lines, benches and anything else that isn't a tee, basket or hole line.
  The review lists them and leaves them out.
- Points past the site's edges. Make the site bigger on the Site step first.
