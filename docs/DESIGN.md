# Designing a screen: phone and computer

Every change someone can see, on a phone or a computer, follows this. It exists because a flyover
redesign once put the phone's sliding glass row on the computer as it was: buttons cut off at
both ends, settings, keyframe actions and export mixed in one strip, nothing like the rest of the
computer's screens. The owner's rule: **each platform matches the GUI of everything else on that
platform.**

## The two GUIs

Build each platform's version from that platform's own parts. Share the names, the order, the
behaviour and the drawings (a timeline, a dial's look, a map mark), not the layout.

**A computer** (`useLayout() === "desktop"`):

- The top bar with the steps (Site, Design, Map, Export).
- The **side panel** (`Inspector.tsx`) for whatever is selected: a title, then `Section`s, each with
  `Field` labels over `Slider`, `Segmented`, `Toggle`, `Select` and `Button` (small or full), and
  `Fold` for the rarer parts. Settings live here, grouped, all visible by scrolling down.
- The **toolbar** along the bottom of the map (`Toolbar.tsx`): the step's tools, icon over label.
- The map's floating buttons at the top right (zoom, 2D/3D, View), and glass cards over the view
  (the hole's card in tee view).
- In-view bars carry only what you act on there and then (play, the holes either side, back),
  never a strip of settings.
- Hover tips with the shortcut key.

**A phone** (`phone`, and `rail` on a phone held sideways), in `src/components/mobile/`:

- The map keeps the whole screen.
- The **glass bar** (`GlassBar.tsx`): a name pill over a row of settings. Menus and dials grow out
  of their button, one at a time; past the edge, +N.
- The steps along the bottom (`BottomNav`), the step's tools in the row above them (`StepTools`),
  and a step's panel coming up out of its tab (`BottomSheet`).
- Icons in lit discs (`Disc`); 44 px targets; long-press for the right-click menu.

**Never** put a phone pattern on the computer wholesale (a sliding settings row, dials for every
number, +N), or a computer pattern on the phone (a tall panel of fields over the map).

## Before showing anything, and before building it

Answer these **for the phone and for the computer separately**, and write the answers to the
owner with what you show:

1. Is this the best implementation for the app's design language and the goal? If not, fix it
   until it is, and say what the check changed.
2. Does it make the app easier to understand? Could it make anything worse for anyone (viewers,
   editors, a small phone, a left hand)? How could you understand the need better?
3. Which of that platform's existing parts does it use? Name them. A new part needs a reason.
4. Is everything there and visible? Nothing cut off, no sideways scrolling on a computer, every
   setting and action from before still reachable.
5. Is it grouped the way someone would look for it: what goes with what (a keyframe's settings
   together, the flyover's together, actions apart from settings)?
6. Are the labels the standard terms (researched in comparable apps) and do they say what pressing
   them does? See `WRITING-STYLE.md` and the labels research in the mockup.

## The process

1. Research how comparable apps do it.
2. Mock up **both** platforms (a phone at 412 × 892 and a computer at 1440 × 900), from the real
   screen's parts and a real picture of the app behind them.
3. Look at the rendered mockup yourself, at full size, for each platform: answer the questions
   above, fix, look again.
4. Show it with the answers. Wait for the owner's clear OK.
5. Build it. Then use it in the browser on both platforms, with real taps and clicks (not clicks
   sent from code), and look at screenshots of both before calling it done.
