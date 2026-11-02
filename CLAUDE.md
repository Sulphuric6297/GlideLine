# GlideLine Studio: working rules

A React + Vite + TypeScript app in two builds from one codebase:

- **The demo** (the default build), a static site on GitHub Pages: no accounts, no server and no
  API keys; courses are kept in the browser.
- **For a GlideLine Studio server** (`VITE_SERVER=1`): the same app behind sign-in, served by the
  self-hosted server in `server/` (accounts, invites, 2FA, courses kept on the server and shared with roles).

It is built on the map engine of the Security Camera Planner: the same site import (satellite
photo, elevation, trees), terrain, and one map view that is 2D looking straight down and 3D when
tilted.

What the owner asked for is in `docs/WANTS.md`. Keep it up to date, and tick an item only once
it has been seen working in the browser. `docs/RESEARCH.md` holds the research on other course
design tools and the PDGA guidance the app follows.

## Privacy (never break this)

- **Never put the owner's personal details in the repository.** That means no address, street,
  town, ZIP code, coordinates of their property, name, email, or photos and screenshots of
  their place. This covers code, tests, fixtures, docs, file names, commit messages, pull
  requests and the deployed site. The repository is public.
- Examples, fixtures and walkthroughs use made-up places ("Springfield Park").
- A check runs on every commit (`scripts/privacy-check.mjs`, hooked up by `npm ci`). It refuses:
  - an author without a no-reply email;
  - any added email address;
  - any `zz-*` file.

  It cannot recognise an address or a town, so read your diff and commit message for those yourself.

## The server (`server/`)

- Node + TypeScript: Fastify, Postgres through `postgres` with plain SQL migrations
  (`server/migrations/`, applied in order at start), `@node-rs/argon2` for passwords, `zod` for
  input. 2FA codes (TOTP), tokens and encryption at rest are in `server/src/crypto.ts`, on
  `node:crypto` alone.
- Invite-only: the first account (the admin) needs the setup code the server prints at its first
  start; everyone after comes in by an invite link the admin makes. 2FA is required before
  anything else. No email is needed or kept.
- Security rules to keep: sessions are random tokens in HttpOnly, SameSite=Strict cookies with
  only their SHA-256 in the database; every request that changes something needs the
  `x-hyzerlab: 1` header and an allowed origin; sign-in routes are rate limited; failed
  passwords rest an account; every account change goes in `audit_log`; 2FA secrets are encrypted
  with `APP_SECRET`. Check permissions in the server, never only in the app.
- Courses on the server: `courses` (the document as JSON, without its aerial photo, which is in
  `course_backgrounds`), and `course_members` with a role each: owner (shares, deletes), editor
  (changes), viewer (looks). Someone else's course answers 404. Each save names the version it
  was made from; an older one is refused (409, saying who saved). A course needs an owner; a
  removed person's courses that only they owned pass to the admin removing them.
- Drafts and history (`server/src/routes/versions.ts`, `server/src/history.ts`): owners save
  straight into the course; editors save into a draft of their own (`course_drafts`, with what it
  started from). Publish merges the draft into the course as it is now (`src/lib/merge.ts`, three
  ways, by hole, feature and layout id) and sends it with the version it merged with. With the
  owner's switch on (`courses.approval`), editors send drafts (`course_submissions`) and the owner
  accepts or declines. Every publish, restore and the owner's own changes every ten minutes go in
  `course_versions`; before anything replaces the course, its current state goes there too.
  Restoring makes a new version. Compare documents only in the app's own form (`normalizeCourse`
  of `safeDoc`).
- A course from the server is cleaned by `src/lib/safeDoc.ts` before it's shown (pictures must be
  image data URLs; only free text may hold < > " or `): parts of the map are built as markup
  from the course's values. Keep it in step when a new kind of text or picture field is added.
- The app's side is `src/auth/` (the sign-in screens, the account menu and dialogs, saving to the
  server in `courses.ts`; `src/state/files.ts` hands over to it when `SERVER`). The demo
  build never shows any of it: `SERVER` (`src/auth/api.ts`) is false there.
- Settings come from the environment (`server/src/config.ts`). Real values, the domain and the
  server's address never go in the repository.
- Develop: `docker compose -f server/compose.dev.yml up -d` (Postgres on 127.0.0.1), then
  `cd server && npm ci && npm run dev` with a `server/.env` (git-ignored), and
  `VITE_SERVER=1 npm run dev` for the app (it proxies `/api` to the server).

## Design (read before any change someone can see)

**Each platform matches the GUI of everything else on that platform.** A computer's version is
built from the computer's parts (the side panel's sections and fields, the toolbar, the map's
floating buttons); a phone's from the phone's (the glass bar, the steps, the panel out of its
tab). Share names, order and behaviour, not the layout. Before showing a mockup and before
building, answer the questions in `docs/DESIGN.md` for the phone **and** the computer, in writing,
and wait for the owner's OK. After building, use it in the browser on both, with real taps and
clicks, and look at screenshots of both.

## How to work

- **Look at the real app, not just the tests.** For any UI change or UI bug:
  1. Run `npm run look`; screenshots of the main screens land in `look/`.
  2. Make the fix.
  3. Look at the same screens again.
  4. Show the before/after screenshots.
- **Say only what you have seen.** Call a feature working only after using it in the browser.
  Call it live only after the deployed site serves the new build.
- Develop on a feature branch. Do not merge to `main` (which deploys) without the owner's OK.
- **No explainers, anywhere.** Never put text in the app or on anything it prints or exports that
  explains why something works the way it does or how it works (e.g. "Par from the PDGA par
  guidelines", "Play safe: wait until the fairway ahead is clear", "Made with Disc Golf Course
  Designer", helper paragraphs under settings). Labels, values and short tool prompts only.
  One exception, at the owner's request: the demo's **Demo** note (`src/components/DemoNote.tsx`),
  saying what the hosted version adds.

## Testing

- Every change is tested in full once, by CI on each push (a pull request shows that run): the typecheck, and the
  end-to-end suite split four ways (`--shard`). A change to only Markdown or `docs/` skips it.
  Don't also run the full suite yourself.
- While working: run `npm run typecheck`, `npm run build`, and the spec files for the areas you
  changed (`npx playwright test tests/e2e/<area>.spec.ts`).
- Every bug fix adds a test that fails without the fix. Every new feature adds a test.
- `tests/e2e/fixtures.ts` **stubs all network traffic**: imagery tiles, elevation, geocoding
  and OpenStreetMap all return fixed local data, and anything else is aborted. Each test starts
  with empty storage and fails on any uncaught page error.
- Tests read the app through these hooks; keep them:
  - `window.__dgCourse()`: the course document;
  - `window.__dgEditor()`: the editor state;
  - `window.__dgHistory()`: undo and redo;
  - `window.__dgView`: the map view, with `toClient`, `toPlan`, `screenBox`, `fitHole` and `viewInfo`.
- Playwright is pinned to the version whose Chromium is installed in Claude Code cloud
  sessions (1.56.1). First-time setup is `npm ci`. On any other machine, also run
  `npx playwright install chromium`.

Server: `cd server && npm test` (needs the dev database; it empties `hyzerlab_test`), and
signing in through the app: `npx playwright test -c playwright.server.config.ts` (empties
`hyzerlab_e2e`). CI runs both (`.github/workflows/server.yml`) when the server or `src/auth/`
changes.

| Spec | Area |
| --- | --- |
| `smoke.spec.ts` | Loads, welcome card, steps, 2D/3D, shortcuts dialog, Go to (Ctrl+K or /: a hole by number, a step, a named thing), a fit without animation in place at once |
| `holes.spec.ts` | New holes (tee then basket), going from hole to hole (the panel's arrows, [ and ]), live length and par, doglegs, plotting the line by hand (clicks or freehand), walks off the green (pure logic), fairway width (shaped along the hole with its four width squares, the overall slider, Even width), extra tees and pins, layouts, hole order, delete + undo |
| `features.spec.ts` | Drawing OB areas and lines, hazards, water (click by click, or dragging a rectangle, circle or freehand shape), one-click OB along a hole or behind its basket, marking a road OB (all of it, or stretches marked with two clicks or from its right-click menu, their ends dragged along it; OB and beyond, for the hole beside it or the holes picked), a stretch taken out of a road (two roads left, or only shorter), mandos (passed on the line's side, direction), drop zones, trees, amenities (pictograms), labels, moving and reshaping shapes |
| `select.spec.ts` | Picking several things at once: Shift+drag or the Select option draws a box (a shape only when all of it is inside), Shift+click adds or takes out, Ctrl+A; moving, nudging, duplicating, locking and deleting them together (one undo step each), whole holes with their bends; a finger with the map's box button |
| `structures.spec.ts` | Built things: bridges, boardwalks, stairs, walls, buildings, shelters and decks drawn with the Build tool (S) or the Features list, inspector (kind, width, height, roof, name), undo/redo, corner and mid handles, moving, delete; their 3D models; deck heights over a creek's dip, boardwalk ramps, stair risers, gable and hip roofs (pure logic); drawn in every map style with legend lines, roofs lit by the map's sun; older courses still load |
| `import-site.spec.ts` | Address search, framing the area, photo + elevation + trees + OpenStreetMap paths and water (no stray paths: crossings, sidewalks, squares, indoor ways, parking aisles; map-tile paths once, joined at tile edges), elevation change per hole; stands of trees on the photo as woods areas (lone trees stay trees), ponds on the photo as water (not pools or courts, not twice with OpenStreetMap's), OpenStreetMap woods and grass (meadow, grassland, scrub, lawn) as areas |
| `stats.spec.ts` | Hole math: PDGA effective length and par, doglegs, foliage, trees and OB in play (what counts as OB), OB along stretches of a road or OB and beyond (in play only there, on the tee sign, drawn on the hole's side; for the holes picked, one side when none are), a stretch taken out of a line (its OB stretches and widths shared out), safety checks, design checks (each with an id that stays as the course changes or its holes are reordered, ignored ones left out, none between holes sharing a basket), curved OB, water and roads counted as drawn, fairway width along the hole (pure logic) |
| `review.spec.ts` | The Review step's checks: ignoring one (out of the list and the count, kept with the course), bringing it back, one undo step |
| `views.spec.ts` | View from the tee, flyover (a slow frame doesn't skip it), back to the map (nothing of the flight left over it); grass on the ground under the 3D trees; the painted map on the ground from a tee and in flyovers (trees on its woods; Photo instead), flyover settings (height, speed, field of view: one undo step each), a hole's keyframes (on the map, dragged, set, added, removed, flown); a hole cut through woods flown at its height between their trees; the flight by itself at its height over the ground (round, under or over the trees standing there, from past trees behind the tee), through keyframes (following the ground between them, the speed changing smoothly through each), never jolting near trees or between keyframes (pure logic) |
| `scene3d.spec.ts` | The 3D look: sky when tilted, the course's sun and brightness, grass blades (when shown, the setting kept, what grows where), woods of real trees (full detail near the camera, none on fairways, ponds, tees or baskets), landscapes (pine forest, the painted map's colors), water (level ponds never under the ground), quality that adapts to slow frames (however slow, within seconds), phone defaults, the map view resting while the Design page covers it, a basket close enough drawn at its real size (no badge), built like a real one (band, chains to a collar, wire tray; lighter farther off), placed pines darker than leafy trees |
| `design.spec.ts` | Map designer: themes, colors, title block, legend, hole table, contours, turning the map; the Forest painting (tree cover from sparse to dense, winding creeks and trails, light and shadow settings), basket marks (five kinds, legend, older courses), marking colors (map or PDGA: OB, hazard, casual, out of play), elevation (relief exaggeration, contour heights, hills on the painting), painted water (light rim and shallows, deep middle), tall grass (straw-colored tufts, its own color, in the legend), the page never freezing while the map paints, a phone's smaller preview, zoomed in with every edge of the page in reach; the printed map's and tee signs' contents |
| `export.spec.ts` | Course map (SVG/PNG/PDF), tee signs, scorecard, GeoJSON, KML, GPX, CSV, stake-out list, parts list; hole by hole: a PDF page and a PNG per hole, one hole's PNG/SVG/GeoJSON (only its own features, plus the course's OB in play), the hole page's contents (pure logic) |
| `video.spec.ts` | Flyover videos: recording a hole from the Export step (progress, a real WebM/MP4 that plays at the asked size and length), Cancel, going on when the step is left, Record over the flyover, the view from the tee holding still while a video records, the MediaRecorder fallback without WebCodecs (getting the next hole ready left out of the video), MP4 when H.264 can be encoded (stand-in encoder); codec levels and the frames of a recording (pure logic) |
| `merge.spec.ts` | Putting a draft into a course that changed meanwhile: what only one side changed kept, both: the draft's (listed), removed holes, the photo never merged, what a draft changes counted (pure logic) |
| `persistence.spec.ts` | Autosave restore, course files (painted the same when opened), New keeps the old course in Recent courses |
| `lidar.spec.ts` | Trees and ground measured from the air (USGS LiDAR): reading a tile, each tree as tall and wide as it stands (conifers told apart), the ground; on import or from the Site step (Undo takes it back); trees on fairways, tees and baskets cut down, a stump to bring each back, a hole's Bring all back / Cut all down, a tree cut down from its right-click menu; flyovers keep clear of the trees standing |
| `mobile.spec.ts` | Phones and tablets (device emulation, touch): opening a course file from the menu, the map's buttons above the panel (compass once turned), the selected hole's header stepping to the next hole, the step bar, the bottom sheet's three heights (drag, tap, keys), a hole and an area laid out with taps (Undo, Cancel, Done), the selection in the sheet, long-press menus (width squares never over the tee), pinch without placing, the app never scrolling as a whole, the Design preview fitted to the screen (a pinch while it paints still ends), the tee view, 44 px targets, a phone on its side (rail + panel), a tablet, and the desktop layout unchanged at 1600 × 1000 |

## Project conventions

- Plan units are feet. Plan (x, y) runs east and south from the site's north-west corner, and is
  3D world (x, z) with Y up.
- The course document is in `src/state/course.ts` (zustand, with undo and redo); its types are in
  `src/types.ts`. Editor-only state (selection, tool, view) is the `useEditor` store.
- Pure logic goes in `src/lib/`:
  - `holeStats.ts`: par, lengths and checks;
  - `geom.ts`;
  - `mapSvg.ts`: the printed map (vector shapes and labels);
  - `symbols.ts`: the symbols drawn the same on the printed map, tee signs, legend and the
    editor's map (basket marks, mandos, drop zones, amenity pictograms, built things);
  - `structures.ts`: built things' shapes (bridge decks, boardwalks, steps, roofs), shared by
    the printed map, the Forest painting and the 3D models in `src/three/structures.ts`;
  - `forest.ts`: the Forest style's painted land (one picture: canopy height field lit from the
    top left, fairways, dirt, water, roads), cached by what it depends on;
  - `exports.ts` (the course's and one hole's GeoJSON, KML, GPX, CSV, parts list);
  - `teeSign.ts` (tee signs, hole sheets, scorecard) and `holePage.ts` (a yardage-book page per
    hole, on paper or as a square picture);
  - `video.ts`: flyover video sizes, codec strings and the frames of a recording;
  - `flight.ts`: flyovers' camera paths (by itself over the trees, or through a hole's keyframes)
    and their settings;
  - `lidar.ts`: trees and ground from LiDAR points (canopy height, single trees, the ground on the
    plan's grid), and which measured trees stand (cut down on fairways unless kept);
  - `geo/`: site import (`geo/lidarFetch.ts` reads the newest USGS survey over a site from AWS,
    picked from `public/lidar-index.json`, made by `scripts/lidar-index.mjs`).
- The map view engine is `src/viewport/CourseView.ts`, wrapped by `src/components/MapViewport.tsx`.
- Phones and tablets: `useLayout()` (`src/components/useLayout.ts`) picks the layout: `phone`
  (under 768 px wide: a bottom sheet and a step bar), `rail` (768 to 1023 px wide, such as a tablet
  held upright, or a short, wide screen such as a phone on its side: a step rail and a side panel)
  or `desktop` (1024 px and wider: computers and tablets on their side, unchanged). The phone layouts are in
  `src/components/mobile/` (`CompactShell.tsx`, `BottomSheet.tsx`, `ActionSheet.tsx`); the step
  panels and the inspector are shared with the desktop. `touch:` Tailwind classes apply where a
  finger is the main pointer (bigger targets, 16 px text fields). Every keyboard or right-click
  action needs a touch path (Done/Undo/Cancel while drawing, long-press menus, map buttons). No
  backdrop blur over the map on touch screens (it costs frames on phone GPUs). The shells never
  scroll as a whole (`overflow: clip`): the bottom sheet reaches below the screen.
- 3D look: `src/three/treeKit.ts` (tree shapes made once and shared: a branching skeleton and
  leaf-spray cards; woods drawn instanced, full detail near the camera), `src/three/grass.ts`
  (blades in two patches that travel with the camera, reading height, what grows where and color
  from textures; `src/viewport/grassMaps.ts` paints what grows where), the sky and haze in
  `CourseView.atmosphere`. The 3D view shows the course in its landscape's natural colors
  (`src/lib/landscapes.ts`), whatever the printed map's style. Without a graphics card (software
  rendering, as in the tests) grass starts off and fewer trees are drawn in full detail.
  Flyover videos are drawn by `CourseView.flightFrames` into an offscreen render target, one frame
  at a time, and encoded in `src/viewport/flyoverVideo.ts` (WebCodecs + mp4-muxer/webm-muxer, or a
  MediaRecorder in real time). Exports run one at a time through `src/state/exportJob.ts`, so they
  go on (with their progress and Cancel shown over the map) when the Export step is left.
- Tests can make small videos: `window.__dgVideo().set({ size: { width: 320, height: 180 } })`.
