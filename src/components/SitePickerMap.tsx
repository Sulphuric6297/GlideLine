import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import L from "leaflet";
import { GeoBounds, SITE_MIN_WIDTH_FT, selectionFromBounds } from "../lib/geo/core";
import { MAP_IMAGERY_SOURCES, MapImagerySource, PICKER_LAYERS, STATE_ORTHO_SOURCES } from "../lib/geo/imagery";
import { fmtDist } from "../lib/units";
import type { Units } from "../types";


/** The frame's color (the theme's fern green), drawing or not. */
const OUTLINE = "#a2cf6a";
const FRAME = "#ffffff";
/** The locate button's picture (a crosshair, as the app's own icons draw one). */
const LOCATE_SVG = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>';

// Interactive satellite map used to pick the site (from the Security Camera Planner).
// Drag pans the map; draw a rectangle with the Draw tool or Shift+drag; then move/resize it with its handles.
// A frame drawn (or sized) smaller than a site can be is left as it was, and `onTooSmall` says so.
// Under the zoom buttons, one that goes to where you are (`onLocate`).
export function SitePickerMap({
  imagery,
  photoIds,
  view,
  selection,
  drawing,
  onDrawingChange,
  onSelect,
  onTooSmall,
  onLocate,
  selectViewSignal,
  units = "ft",
  outline,
  fit,
  arrived,
  brush,
  onTap,
  angle = 0,
  onAngle
}: {
  imagery: MapImagerySource;
  /** The photos the frame was found to have (its states' own drawn over Esri's). */
  photoIds?: string[];
  view: { lat: number; lon: number; zoom: number; key: number };
  selection: GeoBounds | null;
  drawing: boolean;
  onDrawingChange: (drawing: boolean) => void;
  onSelect: (bounds: GeoBounds) => void;
  onTooSmall?: () => void;
  onLocate?: () => void;
  selectViewSignal: number;
  /** The frame's size is said in these. */
  units?: Units;
  /** The park's (or course's) own outline, dashed round it. */
  outline?: { lat: number; lon: number }[] | null;
  /** Flown to, framed (each new `key`). */
  fit?: { bounds: GeoBounds; key: number } | null;
  /** What has come in so far, drawn on the map as it lands: the photo, then the shapes and trees. */
  arrived?: Arrived | null;
  /** The brush as it's tuned, over what came in (drawn on its own, so tuning it stays quick). */
  brush?: { points: { x: number; y: number }[]; color: string }[] | null;
  /** A tap on what came in, at plan feet (the map stays where it is). */
  onTap?: (x: number, y: number) => void;
  /** The frame turned this many degrees clockwise from north, and told when it's turned. */
  angle?: number;
  onAngle?: (deg: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);
  const rectRef = useRef<L.Rectangle | null>(null);
  const handlesRef = useRef<L.Marker[]>([]);
  const onSelectRef = useRef(onSelect);
  const onDrawingChangeRef = useRef(onDrawingChange);
  const onTooSmallRef = useRef(onTooSmall);
  const onLocateRef = useRef(onLocate);
  const onAngleRef = useRef(onAngle);
  onAngleRef.current = onAngle;
  const drawingRef = useRef(drawing);
  onSelectRef.current = onSelect;
  onDrawingChangeRef.current = onDrawingChange;
  onTooSmallRef.current = onTooSmall;
  onLocateRef.current = onLocate;
  drawingRef.current = drawing;

  const boundsToObj = (b: L.LatLngBounds): GeoBounds => ({ north: b.getNorth(), south: b.getSouth(), west: b.getWest(), east: b.getEast() });
  const dimsLabel = (b: GeoBounds) => {
    const d = selectionFromBounds(b, "");
    return `${fmtDist(d.widthFt, units, false)} × ${fmtDist(d.heightFt, units)}`;
  };
  const isUsable = (b: GeoBounds) => {
    const d = selectionFromBounds(b, "");
    return d.widthFt >= SITE_MIN_WIDTH_FT && d.heightFt >= SITE_MIN_WIDTH_FT;
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, maxZoom: 21, attributionControl: true, boxZoom: false })
      .setView([view.lat, view.lon], view.zoom);
    mapRef.current = map;
    const resize = window.setTimeout(() => map.invalidateSize(), 60);
    // (where you are: a button under the zoom buttons, in their look)
    const Locate = L.Control.extend({
      onAdd() {
        const box = L.DomUtil.create("div", "leaflet-bar leaflet-control");
        const a = L.DomUtil.create("a", "site-locate", box) as HTMLAnchorElement;
        a.href = "#";
        a.setAttribute("role", "button");
        a.setAttribute("aria-label", "Go to where I am");
        a.title = "Go to where I am";
        a.setAttribute("data-testid", "site-locate");
        a.innerHTML = LOCATE_SVG;
        L.DomEvent.disableClickPropagation(box);
        L.DomEvent.on(a, "click", e => { L.DomEvent.preventDefault(e); onLocateRef.current?.(); });
        return box;
      }
    });
    if (onLocateRef.current) new Locate({ position: "topleft" }).addTo(map);

    // Rectangle drawing: Draw tool, or Shift+drag at any time. Pointer events so touch works too.
    const container = map.getContainer();
    let start: L.LatLng | null = null;
    let startPx = { x: 0, y: 0 };
    let preview: L.Rectangle | null = null;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !(drawingRef.current || e.shiftKey)) return;
      if ((e.target as HTMLElement).closest(".leaflet-control, .site-handle")) return;
      e.preventDefault();
      e.stopPropagation();
      container.setPointerCapture?.(e.pointerId);
      start = map.mouseEventToLatLng(e as unknown as MouseEvent);
      startPx = { x: e.clientX, y: e.clientY };
      preview = L.rectangle(L.latLngBounds(start, start), { color: FRAME, weight: 3, fillColor: FRAME, fillOpacity: 0.1, dashArray: "8 6", interactive: false }).addTo(map);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!start || !preview) return;
      e.preventDefault();
      e.stopPropagation();
      const b = L.latLngBounds(start, map.mouseEventToLatLng(e as unknown as MouseEvent));
      preview.setBounds(b);
      preview.unbindTooltip();
      preview.bindTooltip(dimsLabel(boundsToObj(b)), { permanent: true, direction: "center", className: "site-picker-tooltip" }).openTooltip();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!start) return;
      e.stopPropagation();
      const b = L.latLngBounds(start, map.mouseEventToLatLng(e as unknown as MouseEvent));
      preview?.remove();
      preview = null;
      start = null;
      const bounds = boundsToObj(b);
      if (isUsable(bounds)) {
        onSelectRef.current(bounds);
        onDrawingChangeRef.current(false);
      } else if (Math.hypot(e.clientX - startPx.x, e.clientY - startPx.y) > 6) onTooSmallRef.current?.();
      // (a tap, not a drag: still drawing)
    };
    container.addEventListener("pointerdown", onPointerDown, true);
    container.addEventListener("pointermove", onPointerMove, true);
    container.addEventListener("pointerup", onPointerUp, true);
    return () => {
      window.clearTimeout(resize);
      container.removeEventListener("pointerdown", onPointerDown, true);
      container.removeEventListener("pointermove", onPointerMove, true);
      container.removeEventListener("pointerup", onPointerUp, true);
      map.remove();
      mapRef.current = null;
      rectRef.current = null;
      handlesRef.current = [];
      layersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.setView([view.lat, view.lon], view.zoom);
  }, [view.key]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getContainer().style.cursor = drawing ? "crosshair" : "";
  }, [drawing]);

  // "Select this view": the visible map minus a margin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || selectViewSignal === 0) return;
    const b = map.getBounds().pad(-0.12);
    const bounds = boundsToObj(b);
    if (isUsable(bounds)) onSelectRef.current(bounds);
    else onTooSmallRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectViewSignal]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    layersRef.current.forEach(layer => { if (map.hasLayer(layer)) map.removeLayer(layer); });
    const config = PICKER_LAYERS[imagery];
    const attribution = MAP_IMAGERY_SOURCES[imagery].attribution;
    const base = L.tileLayer(config.url, { maxZoom: 21, maxNativeZoom: config.maxNativeZoom, attribution });
    // Statewide 6-inch orthoimagery drawn over Esri inside its region (ImageServer exportImage per web-mercator tile).
    // (only the states' photos the frame was found to have: their rough boxes overlap at the borders)
    const shown = STATE_ORTHO_SOURCES.filter(src => photoIds?.includes(src.id));
    const stateLayers = imagery === "satellite"
      ? shown.map(src => {
        const OrthoLayer = L.TileLayer.extend({
          getTileUrl(this: L.TileLayer, coords: L.Coords) {
            const size = 256;
            const nw = L.CRS.EPSG3857.project(map.unproject(L.point(coords.x * size, coords.y * size), coords.z));
            const se = L.CRS.EPSG3857.project(map.unproject(L.point((coords.x + 1) * size, (coords.y + 1) * size), coords.z));
            return `${src.services[0]}/${src.map ? "export" : "exportImage"}?bbox=${nw.x},${se.y},${se.x},${nw.y}&bboxSR=3857&imageSR=3857&size=${size},${size}&format=png&transparent=true&f=image`;
          }
        });
        return new (OrthoLayer as any)("", {
          minZoom: 14,
          maxZoom: 21,
          maxNativeZoom: 20,
          bounds: L.latLngBounds([src.region.south, src.region.west], [src.region.north, src.region.east]),
          attribution: src.attribution
        }) as L.TileLayer;
      })
      : [];
    const overlays = config.overlays.map(url => L.tileLayer(url, { maxZoom: 21, maxNativeZoom: config.maxNativeZoom }));
    layersRef.current = [base, ...stateLayers, ...overlays];
    [base, ...overlays].forEach(layer => layer.addTo(map));
    // (a state's own photos only on the map, and in its credit, while the map is over that state)
    const regions = shown.map(src => L.latLngBounds([src.region.south, src.region.west], [src.region.north, src.region.east]));
    const sync = () => {
      const seen = map.getBounds();
      stateLayers.forEach((layer, k) => {
        const over = seen.intersects(regions[k]);
        if (over && !map.hasLayer(layer)) layer.addTo(map);
        else if (!over && map.hasLayer(layer)) map.removeLayer(layer);
      });
    };
    sync();
    map.on("moveend", sync);
    return () => { map.off("moveend", sync); };
  }, [imagery, (photoIds ?? []).join()]);

  // The frame: its corners (resize, the opposite corner staying put), the middle of its top edge
  // (move), and a round handle past it (turn: which way is up on the course; north stays north)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    handlesRef.current.forEach(h => h.remove());
    handlesRef.current = [];
    rectRef.current?.remove();
    rectRef.current = null;
    if (!selection) return;
    // (meters east and north of the frame's middle, and back)
    const lat0 = (selection.north + selection.south) / 2, lon0 = (selection.east + selection.west) / 2;
    const mx = 111320 * Math.cos((lat0 * Math.PI) / 180), my = 110540;
    const toLL = (p: { x: number; y: number }) => L.latLng(lat0 + p.y / my, lon0 + p.x / mx);
    const toXY = (ll: L.LatLng) => ({ x: (ll.lng - lon0) * mx, y: (ll.lat - lat0) * my });
    // (turned clockwise by `a`, the way a compass turns)
    const turn = (p: { x: number; y: number }, a: number) => ({ x: p.x * Math.cos(a) + p.y * Math.sin(a), y: -p.x * Math.sin(a) + p.y * Math.cos(a) });
    let live = { c: { x: 0, y: 0 }, hw: ((selection.east - selection.west) * mx) / 2, hh: ((selection.north - selection.south) * my) / 2, a: ((angle ?? 0) * Math.PI) / 180 };
    const corner = (sx: number, sy: number) => { const q = turn({ x: sx * live.hw, y: sy * live.hh }, live.a); return { x: live.c.x + q.x, y: live.c.y + q.y }; };
    const SIGNS: [number, number][] = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
    const ring = () => SIGNS.map(([sx, sy]) => toLL(corner(sx, sy)));
    const frame = L.polygon(ring(), { color: FRAME, weight: 2.5, fillColor: FRAME, fillOpacity: 0.04, interactive: false }).addTo(map);
    rectRef.current = frame as unknown as L.Rectangle;
    const topMid = () => { const q = turn({ x: 0, y: live.hh }, live.a); return toLL({ x: live.c.x + q.x, y: live.c.y + q.y }); };
    const knob = () => {
      // (past the top edge by about 34 px on screen)
      const z = map.getZoom(), mPerPx = (156543.03 * Math.cos((lat0 * Math.PI) / 180)) / 2 ** z;
      const q = turn({ x: 0, y: live.hh + 34 * mPerPx }, live.a);
      return toLL({ x: live.c.x + q.x, y: live.c.y + q.y });
    };
    const setLabel = () => {
      frame.unbindTooltip();
      const b = boundsOfLive();
      frame.bindTooltip(dimsLabel(b), { permanent: true, direction: "top", className: "site-picker-tooltip", offset: [0, -22] }).openTooltip(topMid());
    };
    /** The frame as it is (not turned): its box round its middle. */
    const boundsOfLive = (): GeoBounds => {
      const c = toLL(live.c);
      const dLat = live.hh / my, dLon = live.hw / mx;
      return { north: c.lat + dLat, south: c.lat - dLat, east: c.lng + dLon, west: c.lng - dLon };
    };
    const touch = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
    const cornerIcon = (key: string) => L.divIcon({ className: `site-handle site-handle-corner site-handle-${key}`, iconSize: touch ? [44, 44] : [24, 24], html: "<span></span>" });
    const moveIcon = L.divIcon({ className: "site-handle site-handle-move", iconSize: touch ? [40, 40] : [30, 30], html: "<span>✥</span>" });
    const turnIcon = L.divIcon({ className: "site-handle site-handle-turn", iconSize: touch ? [44, 44] : [28, 28], html: "<span>⟳</span>" });
    const markers: L.Marker[] = [];
    const keys = ["nw", "ne", "se", "sw"];
    const refresh = (except?: L.Marker) => {
      frame.setLatLngs(ring());
      setLabel();
      SIGNS.forEach(([sx, sy], i) => { if (markers[i] !== except) markers[i].setLatLng(toLL(corner(sx, sy))); });
      if (markers[4] !== except) markers[4].setLatLng(topMid());
      if (markers[5] !== except) markers[5].setLatLng(knob());
    };
    const done = () => {
      const b = boundsOfLive();
      if (isUsable(b)) { onSelectRef.current(b); onAngleRef.current?.(Math.round(((live.a * 180) / Math.PI + 360) % 360)); }
      else { onTooSmallRef.current?.(); refresh(); }
    };
    SIGNS.forEach(([sx, sy], i) => {
      const m = L.marker(toLL(corner(sx, sy)), { icon: cornerIcon(keys[i]), draggable: true, keyboard: false, zIndexOffset: 1000 }).addTo(map);
      m.on("drag", () => {
        // (the opposite corner stays where it is)
        const f = corner(-sx, -sy), p = toXY(m.getLatLng());
        const d = { x: p.x - f.x, y: p.y - f.y }, u = turn(d, -live.a);
        live = { ...live, c: { x: f.x + d.x / 2, y: f.y + d.y / 2 }, hw: Math.abs(u.x) / 2, hh: Math.abs(u.y) / 2 };
        refresh(m);
      });
      m.on("dragend", done);
      markers.push(m);
    });
    const mover = L.marker(topMid(), { icon: moveIcon, draggable: true, keyboard: false, zIndexOffset: 1000, title: "Drag to move the area" }).addTo(map);
    let grab = { x: 0, y: 0 }, from = live.c;
    mover.on("dragstart", () => { grab = toXY(mover.getLatLng()); from = live.c; });
    mover.on("drag", () => { const p = toXY(mover.getLatLng()); live = { ...live, c: { x: from.x + p.x - grab.x, y: from.y + p.y - grab.y } }; refresh(mover); });
    mover.on("dragend", done);
    markers.push(mover);
    const turner = L.marker(knob(), { icon: turnIcon, draggable: true, keyboard: false, zIndexOffset: 1000, title: "Drag to turn the area" }).addTo(map);
    turner.on("drag", () => {
      const p = toXY(turner.getLatLng());
      // (the way from the middle to the pointer, by compass; to the degree)
      let a = Math.atan2(p.x - live.c.x, p.y - live.c.y);
      a = (Math.round((a * 180) / Math.PI) * Math.PI) / 180;
      live = { ...live, a };
      refresh(turner);
    });
    turner.on("dragend", done);
    markers.push(turner);
    handlesRef.current = markers;
    refresh();
    // (the knob stays the same distance off the edge on screen as the map zooms)
    const onZoom = () => markers[5]?.setLatLng(knob());
    map.on("zoomend", onZoom);
    return () => { map.off("zoomend", onZoom); };
  }, [selection, angle]);

  // The park's outline, dashed
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !outline || outline.length < 3) return;
    const ring = L.polygon(outline.map(p => [p.lat, p.lon] as L.LatLngTuple), { color: OUTLINE, weight: 2.5, dashArray: "9 7", fillColor: OUTLINE, fillOpacity: 0.1, interactive: false }).addTo(map);
    return () => { ring.remove(); };
  }, [outline]);

  // Flown to a place, framed
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fit) return;
    const b = L.latLngBounds([fit.bounds.south, fit.bounds.west], [fit.bounds.north, fit.bounds.east]);
    // (clear of the panel on the right on a computer, of the sheet at the foot on a phone)
    const wide = map.getSize().x > 700;
    map.flyToBounds(b, { paddingTopLeft: [60, 80], paddingBottomRight: wide ? [400, 40] : [30, Math.round(map.getSize().y * 0.5)], duration: 1.4, maxZoom: 18 });
  }, [fit?.key]);

  // What has come in: the photo over the frame, then shapes and trees (one canvas for them all)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !arrived) return;
    const b = arrived.bounds;
    const at = (x: number, y: number): L.LatLngTuple => [b.north - (y / arrived.height) * (b.north - b.south), b.west + (x / arrived.width) * (b.east - b.west)];
    const canvas = L.canvas({ padding: 0.2 });
    const drawn: L.Layer[] = [];
    if (arrived.photo) drawn.push(L.imageOverlay(arrived.photo, [[b.south, b.west], [b.north, b.east]], { opacity: 1, interactive: false }).addTo(map));
    // (looking before it comes in: each shape's edge in its source's color, and where it came from
    // on hover)
    const tip = (layer: L.Path, text?: string) => { if (text) layer.bindTooltip(text, { sticky: true, direction: "top", offset: [0, -8] }); return layer; };
    for (const a of arrived.areas) drawn.push(tip(L.polygon(a.points.map(p => at(p.x, p.y)), { renderer: canvas, stroke: !!a.stroke, color: a.stroke, weight: 2, fillColor: a.color, fillOpacity: a.opacity ?? 0.55, interactive: !!a.tip }), a.tip).addTo(map));
    for (const l of arrived.lines) drawn.push(tip(L.polyline(l.points.map(p => at(p.x, p.y)), { renderer: canvas, color: l.color, weight: l.weight ?? 3, opacity: 0.95, interactive: !!l.tip }), l.tip).addTo(map));
    for (const t of arrived.trees) drawn.push(L.circle(at(t.x, t.y), { renderer: canvas, radius: Math.max(1.5, t.r * 0.3048), stroke: true, weight: t.color ? 1.4 : 0.6, color: t.color ?? "#d9f2b8", fillColor: t.color ? t.color : "#2f5d34", fillOpacity: t.color ? 0.12 : 0.7, interactive: false }).addTo(map));
    return () => { drawn.forEach(d => d.remove()); };
  }, [arrived]);

  // The brush, as it's tuned: redrawn alone while How much or How thick moves
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !arrived || !brush?.length) return;
    const b = arrived.bounds;
    const at = (x: number, y: number): L.LatLngTuple => [b.north - (y / arrived.height) * (b.north - b.south), b.west + (x / arrived.width) * (b.east - b.west)];
    const canvas = L.canvas({ padding: 0.2 });
    const drawn = brush.map(a => L.polygon(a.points.map(p => at(p.x, p.y)), { renderer: canvas, stroke: true, color: a.color, weight: 1.5, fillColor: a.color, fillOpacity: 0.32, interactive: false }).addTo(map));
    return () => { drawn.forEach(d => d.remove()); };
  }, [arrived?.bounds, brush]);
  // A tap on what came in (never moves the map)
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !arrived || !onTap) return;
    const b = arrived.bounds, w = arrived.width, h = arrived.height;
    const tap = (e: L.LeafletMouseEvent) => onTapRef.current?.(((e.latlng.lng - b.west) / (b.east - b.west)) * w, ((b.north - e.latlng.lat) / (b.north - b.south)) * h);
    map.on("click", tap);
    return () => { map.off("click", tap); };
  }, [arrived?.bounds, !!onTap]);

  return <div ref={containerRef} className="absolute inset-0 bg-white/[0.07]" />;
}

/** What has come in so far, in plan feet over the frame (`bounds`, `width` x `height` ft). */
export type Arrived = {
  bounds: GeoBounds;
  width: number;
  height: number;
  photo?: string;
  areas: { points: { x: number; y: number }[]; color: string; opacity?: number; stroke?: string; tip?: string }[];
  lines: { points: { x: number; y: number }[]; color: string; weight?: number; tip?: string }[];
  trees: { x: number; y: number; r: number; color?: string }[];
};
