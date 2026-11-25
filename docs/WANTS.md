# What the owner asked for

The owner's requests, kept here so none get lost. Every item is checked off only after it has
been seen working in the browser.

## The original request

- [x] **Built from the Security Camera Planner's core engine**
  (https://github.com/Sulphuric6297/Security-Camera-Planner): the same map import, satellite
  imagery, elevation data and one 2D/3D map view, turned into a **disc golf course designer**.
- [x] **Research first**: look at other disc golf (and regular golf) course design software and
  use that research to design a really great disc golf course designer
  (findings: `docs/RESEARCH.md`).
- [x] **Course parts you can add**: fairways, OB (out of bounds), baskets, tees, and
  "everything else you can think of" (mandos, drop zones, hazards, alternate pin positions,
  multiple tees per hole, walking paths, signs, benches, parking and so on).
- [x] **Elevation data, like the camera planner**: real terrain for the site, with elevation
  change shown for each hole.
- [x] **A robust designer to make the map really beautiful**: map styles, colors, labels,
  hole numbers, legend, title block, north arrow, scale bar, contours, trees and so on.
- [x] **Exportable in a way that makes sense**: for example a printable course map, tee signs,
  a scorecard, GPS files (GeoJSON / KML / GPX) and a hole list (CSV).

## Added while the work was under way

- [ ] **Hosted on GitHub**: a static site on GitHub Pages, like the camera planner. No backend
  and no API keys.
- ~~**A share link for a course**~~: taken out at the owner's request, to come back in another way.
- [ ] **Course maps that look like professionally painted course maps** (the owner's example:
  a course map from UDisc). What that look is made of:
  - dense, lush painted woods, with the fairways cut through as bright mown clearings;
  - single trees standing in the fairways;
  - blue creeks winding through the woods, and dirt and gravel paths;
  - small tee pads in their colors (gold, white…), small white basket marks, and bold white
    italic hole numbers;
  - the course name in a big brush-script title laid over the map;
  - a chip for each layout with its par and length ("GOLD LAYOUT · PAR 64 | 7,670'");
  - a full-bleed map, with no frame around it.
- [ ] **The painted look, mimicked closely: water, dirt and trees** (the owner's photo of a
  painted course map on a park sign; everything but the font):
  - woods as a fine, irregular texture of small treetops of many sizes (not round blobs, and
    nothing regular or "mathematical"-looking), dark with sunlit yellow-green flecks, with shadows
    falling onto the fairways and a dark rim where the woods meet them;
  - bright fairways with lighter middles, widening around tees and baskets, and lone trees
    standing in them;
  - brown dirt trails winding from each basket to the next tee, and worn dirt at the tees;
  - a bright blue creek winding through the woods with dark banks, partly under the trees;
  - soft gray roads; small tee pads in their colors; small dark basket marks.
- [x] **Trees can be sparse too**: a setting from a few scattered trees to solid woods.
- [x] **Better basket ("pin") pictures, with several to choose from.**
- [x] **Mandos, OB, hazards and everything else**, rendered perfectly on the map and really easy
  to lay out.
- [x] **Tee signs like the owner's second example** (a wide sign on a post):
  - a light column on the left with the course name, the hole number big in a dark box, a PAR
    tag in the tee color, the distance in big type ("305 FEET") and the hole notes;
  - the hole map on the right in the same painted-woods style, tee at the bottom;
  - the elevation change from the tee along the bottom.

## Second round (the owner's feedback on the maps)

- [ ] **Beautiful, aesthetically pleasing maps are the one real requirement.** The maps must
  replicate the owner's reference course's painted maps in every way (looked up online):
  - really dark, speckled trees contrasted with the grass;
  - darker water colors;
  - earth tones, less bright tones;
  - trees like the reference sign maker's other course maps: crisp, sponge-dabbed leaf clumps
    with pale sunlit tops and near-black gaps, and a shade band where the woods meet the grass.
- [x] **Shadows and light are settings** that can be changed (the painted map's Light and
  shadow section, and the 3D view's Light and grass panel share one sun).
- [ ] **Good for visualizing in 3D**, planning a course, and creating beautiful maps.
- [ ] **Renders look really great, not cheesy 3D**; the 3D view is a true perspective.
- [x] **Grass is rendered as blades of grass in 3D**, from short greens up to tall grass
  (mown fairways, longer grass between holes, knee-high in the rough).
- [x] **Any type of terrain** is handled: landscapes (wooded park, open park, pine forest, dry
  grass, autumn, desert) for the painted map and 3D, and relief shading that suits gentle or
  steep ground.
- [x] **Placing individual trees** is an option (the Tree tool: leafy, pine, palm, bush).
- [x] **Buildings, bridges and any other infrastructure** are available: bridges, boardwalks,
  stairs, walls, buildings, shelters and decks, in 3D and on every map style.
- [x] **Industry-standard symbols**, after researching what official disc golf maps use: the
  PDGA's marking colors (white OB, yellow hazard, blue casual, red out of play) or the common
  map colors, with legend lines that say what each means for play.
- [x] **A record option to export flyovers** as video files (seen as WebM; MP4 needs a browser
  with H.264 encoding, not available in the test browser):
  - one hole, or the whole course in order, at 720p, 1080p, 1440p or 4K, 30 or 60 fps;
  - smooth however slow the computer (made frame by frame, not filmed off the screen), as an MP4
    where the browser can make one (WebM otherwise);
  - the hole's number, par and length on screen, and the basket marked with the distance left;
  - a Record button in the Export step (with progress and Cancel) and over the flyover itself.
- [x] **Per-hole exports too, not just the whole map**:
  - a page per hole like a yardage book or a hole map in a scoring app: the hole's map with the
    tee at the bottom, number, par, the length from each tee color, elevation change and "plays
    like", the hole notes and a small elevation profile;
  - Letter, A4, a 4 × 6 in card, or a square 1080 px picture for sharing;
  - all holes as one PDF or a ZIP of pictures; one hole as PDF, PNG, SVG or its own GeoJSON.

## Third round

- [ ] **Don't just follow the owner's directions**: look up how to actually make it look good,
  research whether it's possible, and only build what makes it look great — something anyone
  would love to look at.
- [x] **Elevation is translated well on 2D maps**: hills read through the painted woods (lit and
  shaded sides, Swiss-style warm and cool), illuminated contour lines painted on the open ground,
  contour heights on the drawn styles, relief exaggerated to suit the course.
- [x] **Fairways can be widened**: all along, or in places (a wide landing zone, a pinched gap)
  with the width squares along the hole.
- [ ] **Mobile friendly**, as a well thought out mobile navigation platform (not a strap-on),
  while working just as well on desktop: see "Phones and tablets" below.
- [x] **A half wooded, half open course looks good either way** (tested on purpose: the painted
  map with drawn woods only, with woods everywhere, in 3D and from a tee; 3D woods now keep off
  the fairways and the pond).
- [x] **Water looks better, not plain**: painted ponds with light shallows, a bright rim, faint
  water lines and a deep middle; 3D water mirroring the sky and the treeline, with small waves.
- [ ] **Mobile performs perfectly** (researched): the engine side is done and measured (never
  freezes while the map paints, lighter 3D on phones, quality that adapts within seconds however
  slow the phone, the hidden map view rests, nothing drawn while the map sits still, a flyover
  recording never waits on the screen's breeze); the phone layout's own (the sheet on the GPU, no frosted glass, taps answered in
  under 50 ms) is in "Phones and tablets" below. Still to check on a real phone.

## Phones and tablets

- [ ] **Mobile friendly, "not a strap-on feature but a well thought out mobile navigation
  platform", and just as good on desktop.** Researched first (`docs/RESEARCH.md`, "Phones and
  tablets"). Seen in Chromium's phone and tablet emulation; still to check on a real phone:
  - the map is the screen; the six steps in a bar at the bottom (a rail on the left with the
    phone on its side); the desktop layout unchanged, tablets keep the side panel;
  - the step's panel and the selection in a bottom sheet that rests at peek, half and full
    height (drag, flick, tap its handle, arrow keys), never hiding the whole map;
  - tools in a labelled row at the top of the sheet; drawing by taps with Undo, Cancel and Done;
    holding a finger on a thing opens its menu; pinch, two-finger turns and the 44 px map buttons;
  - the Design preview fitted to the screen (pinch or + and −), the tee view laid out for an
    upright phone, dialogs as sheets from the bottom, readable text;
  - "make sure mobile works performance perfectly": the sheet slides on the GPU, no frosted
    glass over the map, measured on a throttled phone profile (`docs/RESEARCH.md`).

## Fourth round (after going live)

The goal behind every item: beautiful, aesthetic course maps. Ticked only once done in full, seen
working in the browser and tested.

Site and import
- [ ] **OpenStreetMap rivers, roads and paths actually come in** (busy servers, rivers and lakes
  mapped in pieces, cut to the site; Try again when unreachable; update from the Site step).
- [ ] **Imports bring large stretches of trees, water and grass in as areas** (Woods, Water, grass
  areas), not just single trees.
- [ ] **The map can be made bigger or smaller without losing the design** (holes and features
  stay on the same ground).

Editing
- [ ] **Drag to select several items at once**, and work on them together.
- [ ] **Several holes (their own numbers and tees) can share one basket.**
- [ ] **Fairways bend**, not just straight lines.
- [ ] **Walks from one hole to the next are fully editable**; a drawn walk replaces the
  automatic one in the final design.
- [ ] **Buildings are editable like in the Security Camera Planner.**
- [ ] **Buildings and other shapes can be drawn as rectangles** (it only did points).
- [ ] **Buildings needn't look like houses; a shelter can be a gazebo.**
- [ ] **Trees placed on a fairway or in its rough show as placed**, not swallowed by or cleared
  for the painted woods.
- [ ] **A tree brush** (offered; not asked yet).

Map design
- [ ] **Forest is the only style**; the styles are variations of landscape and colors (the other
  styles are gone). Landscape, light and shadow, symbols and the rest stay.
- [ ] **No explainers anywhere** in the app or on what it prints (never add any).
- [ ] **The legend can be moved anywhere on the map.**
- [ ] **Elevation scaling is a setting** that can be fine-tuned.
- [ ] **Map keys list only what is on that map** (the hole card's key).
- [ ] **The hole card's whole style is editable** (colors and such).
- [ ] **The tee sign's info column looks good** (it was sparse, with a "course map" of bare lines).
- [ ] **The final render is print quality, for prints and large maps** (exports at 300 dpi,
  about 200 dpi on big posters, the painted land painted to match; a 36 × 48 in poster).
- [ ] **No black specks in the painted woods** (beside the treetops).
- [ ] **Scorecards look like the Innova card** (Distance or Par, Name, 1–9, Front, 10–18, Back,
  Total; Date, Par, Course), with a place to upload the course logo.

3D and flyovers
- [ ] **Flyovers are beautiful, in the Design look** (the ground rendered as designed, not the
  satellite photo).
- [ ] **Flyovers can be keyframed**; camera position, height, speed and field of view are
  settings.
- [ ] **The default flyover avoids trees.**

Later requests (in the order asked)
- [ ] **Widening a fairway on one side doesn't widen the other** (Shift widens both).
- [ ] **Drawn buildings and other shapes can be turned.**
- [ ] **Duplicate puts the copy next to the original.**
- [ ] **Tees that share a basket each have their own fairway, merged where they meet.**
- [ ] **Any hole number can be picked**, typed in, beyond the number of holes; a hole can have
  more than one number (3/12).
- [ ] **Several walks from a shared basket, each saying which hole it goes to.**
- [ ] **Paths can be extended after they're placed**; every drawn line and shape curves through
  its points (rectangles keep their corners).
- [ ] **Everything on the Design page is editable** (text, labels moved, the map itself fixed).
- [ ] **The Design preview always shows the latest changes**, with progress while it paints.
- [ ] **A creek's width can be set as a whole and stretch by stretch.**
- [ ] **The walk to the next hole is drawn over other paths**, with one width setting for all
  walks, the automatic walks switchable, and a single walk removable.
- [ ] **The fairway can be widened anywhere along a hole.**
- [ ] **OB lines and areas can belong to several holes.**
- [ ] **Flyovers: total control per hole** (height, speed, view, keyframes), smooth (no bobbing),
  going under trees, as good-looking as the Design page, slowing gently to a stop at the end,
  drawn farther in videos, and switches for everything on screen (title, badge, distance to the
  pin, course name, disc flight, line of play, putting circle, OB, other holes, walks).
- [ ] **The yellow disc flight lines can be switched off everywhere.**
- [ ] **Settings for all holes can be set from any hole's panel, and one hole's settings applied
  to the holes picked.**
- [ ] **Tall trees don't stretch; a tree's crown is as wide as set at any height.**
- [ ] **Tee signs: the featured hole stands out; every part shown or hidden, for all holes or one.**
- [ ] **The Design page zooms with the wheel and pans by dragging.**
- [ ] **Checks can be ignored** (and brought back).
- [ ] **Better-looking grass in 3D.**
- [ ] **Tee pads never cut through the ground; the tee sign has no pole through it.**
- [ ] **Flyovers stay 10 ft over the ground the whole way** (by default), round, under or (only
  where they must) over the trees standing there, never through them; keyframed flights keep
  their height over the ground between keyframes.
- [ ] **The basket is its real size in 3D.**
- [ ] **3D trees don't look cheap** (small leaves, fine needles, pines darker than leafy trees).
- [ ] **Flyovers never shake or jolt** (round trees, between keyframes): smooth curves, the view
  turning gently, the speed changing smoothly through each keyframe.
- [ ] **The basket looks like a real disc golf basket in 3D** (colored band, chains hanging to a
  collar, wire tray).
- [ ] **Stretches of a road (or path, fence, creek) can be OB**, marked with two clicks on it, and
  a road (or path) can be OB and beyond (OB from its edge on the hole's side).
- [ ] **Zoomed in on the Design page, every edge of the map can be reached.**
- [ ] **Real trees from LiDAR** (USGS, where a survey covers the site): each tree where it
  stands, as tall and wide as it is; trees on a hole's fairway cut down, with an easy way to bring
  them back (a stump to click, or all of a hole's at once) and to cut down others.
- [ ] **OB and beyond for the holes picked**: drawn on their side of the road only (never both
  sides at once unless holes on both sides are picked), in play and on the tee sign only for them.
- [ ] **A stretch of a road (or any line) can be taken out**, marked with two clicks like an OB
  stretch.

- [ ] **A site in Denmark comes in on Denmark's own open maps** (Dataforsyningen, free, with a
  free token kept in the browser): the ground from Danmarks Højdemodel (0.4 m), the trees standing
  on it measured from its surface, and the spring orthophoto; open source only, nothing paid.
- [ ] **European trees and bushes**: beech, and hazel and hawthorn bushes, with Denmark's most
  common kinds (spruce, beech, oak) recommended for a course there.

## Your own server (GlideLine Studio)

The owner's requests for the self-hosted version, in the order they came. Checked once seen
working in the browser.

**Open source, and hosted**
- [x] **Stays open source, with no personal details in it** (AGPL-3.0).
- [x] **Named GlideLine Studio** (first GlideLine Studio).
- [ ] **Runs on the owner's own server, not only GitHub Pages**: a ready-to-run container
  (app and server together), `docker compose`, versioned images, backups, a production address.
  (A development server runs now.)
- [ ] **GitHub Pages stays as a demo** with every feature it can have, kept up with the main app,
  and a note saying what the hosted version adds.
- [x] **Tests don't take forever for small changes** (once per push, split four ways).
- [x] **Work on a branch, with a way back if something breaks** (`main` only through pull
  requests; server snapshots).

**Accounts**
- [x] **Invite-only, the owner as the admin; its own users, permissions and boundary.**
- [x] **As secure as possible, with two-factor sign-in for everyone.**

**Courses and sharing**
- [x] **Editors and viewers** (and owners), per course.
- [x] **A page for the courses you have and the ones shared with you**, nicely designed (each
  course as a card with its rendered map), to pick the course you want.
- [x] **View only means view only**: no fields to change anything.
- [x] **A viewer can copy a course** and change the copy.
- [ ] **Granular view permissions**: what a viewer can see, chosen when sharing: the map, the 3D
  view, flyovers, the rendered map, tee signs, the scorecard, hole stats, downloads, making a copy
  (for example only the 3D view, or only rendered maps and flyovers).
- [ ] **Public sharing**: a course shared with anyone (view only by default, with the same
  permissions), and **a public course website** that shows the map, the 3D view, tee signs and
  so on, only what the owner approved.
- [ ] **Several courses on one map** (one park, its courses or layouts drawn on it together).

**Editors' changes**
- [x] **Editors' changes save as they go into a draft of their own**, and go into the course
  only when they publish (submit) it.
- [x] **The owner can turn on approval**: submitted drafts wait for the owner's OK (off: they
  publish straight away).
- [x] **A history of changes that can be reverted.**
- [ ] **Comments.**

**Fixes**
- [ ] **Editing is fast**: dragging and changing things is laggy now (a bigger redesign is fine
  if it's needed).
- [ ] **LiDAR helps, never hinders**: no trees in rivers, on roads or anywhere else they don't
  belong.
- [ ] **The Search button never turns the screen black** (not seen again on a fresh build; a
  failure now shows what went wrong).
