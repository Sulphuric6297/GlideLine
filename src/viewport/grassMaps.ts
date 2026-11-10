// What grows where, for the 3D grass (see three/grass): the blades' height and density, and their
// color, painted from the course. Mown fairways and greens, longer grass between the holes, tall
// grass in the rough, a thin forest floor in the woods, mown grass on sports fields, and none on
// water, sand, paving, paths, roads, creeks, tee pads, painted dirt, courts, pools or infields.
import { heightAt } from "../lib/terrainGrid";
import { corridor, rectCorners, smoothPath } from "../lib/geom";
import { GROUND_MATERIALS, PAINT_CELL_FT } from "../lib/groundPaint";
import { LINE_KINDS } from "../constants";
import { drawnAreas, fairwayOutline, linePath, teeAim, teeLines, widthAlong, widthVaries } from "../lib/course";
import { landscapeOf } from "../lib/landscapes";
import { GRASS_INKS, fieldPlan } from "../lib/fieldPlan";
import { GRASS, type GrassMaps, type GrassTerrain } from "../three/grass";
import type { AreaItem, LineItem, P, TeeItem } from "../types";
import type { ViewDoc } from "./types";

/** The blades' colors: the course's own (its map colors), toned toward a real lawn's. */
const blend = (a: string, b: string, k: number) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
};

const field = (h: number, density: number) => `rgb(${Math.round((h / GRASS.max) * 255)},${Math.round(density * 255)},0)`;

export const grassMaps = (doc: ViewDoc): GrassMaps | null => {
  if (typeof document === "undefined") return null;
  const { width, height } = doc.canvas;
  const scale = Math.min(1, 2048 / Math.max(width, height));
  const W = Math.max(1, Math.round(width * scale)), H = Math.max(1, Math.round(height * scale));
  const make = () => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    return { c, g };
  };
  const f = make(), t = make();
  const st = doc.course.style;
  const lawnTint = blend(doc.groundColor, "#5f7f3e", 0.25);
  const fairTint = blend(st.fairway, "#6f9a4a", 0.25);
  const roughTint = blend(doc.groundColor, "#8c8a4c", 0.45);
  const floorTint = blend(st.trees, "#5a4a30", 0.45);

  const poly = (pts: P[], fieldStyle: string, tint: string | null) => {
    if (pts.length < 3) return;
    for (const [g, style] of [[f.g, fieldStyle], [t.g, tint]] as const) {
      if (!style) continue;
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.fillStyle = style;
      g.fill();
    }
  };
  const stroke = (pts: P[], w: number, fieldStyle: string) => {
    if (pts.length < 2 || w <= 0) return;
    f.g.beginPath();
    pts.forEach((p, i) => (i ? f.g.lineTo(p.x, p.y) : f.g.moveTo(p.x, p.y)));
    f.g.strokeStyle = fieldStyle;
    f.g.lineWidth = w;
    f.g.lineCap = "round";
    f.g.lineJoin = "round";
    f.g.stroke();
  };

  // Everywhere: longer grass between the holes (as the landscape grows it)
  const land = landscapeOf(st).grass;
  f.g.fillStyle = field(land.lawn, land.density);
  f.g.fillRect(0, 0, width, height);
  t.g.fillStyle = lawnTint;
  t.g.fillRect(0, 0, width, height);
  const areas = drawnAreas(doc.course.items).filter(i => i.type === "area") as AreaItem[];
  const lines = doc.course.items.filter(i => i.type === "line") as LineItem[];
  for (const a of areas) if (a.kind === "woods") poly(a.points, field(0.3, 0.22), floorTint);
  for (const a of areas) if (a.kind === "rough") poly(a.points, field(GRASS.rough, 0.9), roughTint);
  // Fairways: the holes' own corridors and any drawn by hand, mown short
  for (const s of doc.stats) {
    const hole = doc.course.holes.find(h => h.id === s.holeId);
    if (!hole?.fairway || !s.complete) continue;
    for (const line of teeLines(doc.course, hole, s.line, s.teeId)) poly(fairwayOutline(hole, smoothPath(line, 10), 0, 12), field(GRASS.fairway, 1), fairTint);
  }
  for (const a of areas) if (a.kind === "fairway" || a.kind === "green") poly(a.points, field(GRASS.fairway, 1), fairTint);
  // Nothing grows on water, sand, paving or in buildings
  for (const a of areas) if (a.kind === "water" || a.kind === "sand" || a.kind === "parking" || a.kind === "building") poly(a.points, field(0, 0), null);
  // Fields: mown where they're grass (an outfield, a soccer pitch), none on dirt, courts, water or mulch
  for (const a of areas) {
    if (a.kind !== "field") continue;
    const plan = fieldPlan(a);
    if (!plan) continue;
    for (const m of plan.marks) {
      if (m.k === "line") continue;
      const grows = GRASS_INKS.has(m.ink) ? field(GRASS.fairway, 1) : field(0, 0);
      if (m.k === "fill") poly(m.pts, grows, GRASS_INKS.has(m.ink) ? fairTint : null);
      else { f.g.beginPath(); f.g.arc(m.c.x, m.c.y, m.r, 0, Math.PI * 2); f.g.fillStyle = grows; f.g.fill(); }
    }
  }
  for (const l of lines) {
    const w = l.width ?? LINE_KINDS[l.kind].width;
    if (l.kind !== "path" && l.kind !== "road" && l.kind !== "stream") continue;
    // (a creek wider or narrower along the way: its outline)
    if (widthVaries(l)) {
      const along = widthAlong(l, w);
      poly(corridor(linePath(l), t => along(t) + 1, 8), field(0, 0), null);
    } else stroke(linePath(l), w + 1, field(0, 0));
  }
  // Worn ground round each tee, where everyone stands and walks off: thin grass over dirt
  const wornTint = blend("#7a6242", doc.groundColor, 0.3);
  for (const tee of doc.course.items.filter(i => i.type === "tee") as TeeItem[]) {
    // (most of it out in front, where the run-up and the follow-through are)
    const r = Math.max(13, tee.padLength * 1.6) * (doc.unitsPerFoot || 1), aim = (teeAim(doc.course, tee) * Math.PI) / 180;
    const cx = tee.x + Math.cos(aim) * r * 0.3, cy = tee.y + Math.sin(aim) * r * 0.3;
    for (const [g, style] of [[f.g, field(0.12, 0.3)], [t.g, wornTint]] as const) {
      // (thinning out toward its edge, in rings)
      for (const [k, a] of [[1, 0.35], [0.78, 0.5], [0.55, 0.8]] as const) {
        g.globalAlpha = a;
        g.beginPath();
        g.ellipse(cx, cy, r * k, r * k * 0.7, aim, 0, Math.PI * 2);
        g.fillStyle = style;
        g.fill();
      }
      g.globalAlpha = 1;
    }
  }
  for (const tee of doc.course.items.filter(i => i.type === "tee") as TeeItem[]) {
    if (tee.surface === "natural") continue;
    poly(rectCorners({ x: tee.x, y: tee.y }, tee.padLength + 0.6, tee.padWidth + 0.6, teeAim(doc.course, tee)), field(0, 0), null);
  }
  // Painted ground: grass where painted grass, none on dirt, gravel, mulch or paving
  const paint = doc.groundPaint ?? {};
  const cell = PAINT_CELL_FT * (doc.unitsPerFoot || 1);
  for (const key in paint) {
    const m = GROUND_MATERIALS[paint[key] - 1];
    if (!m) continue;
    const [i, j] = key.split(",").map(Number);
    f.g.fillStyle = m.id === "grass" ? field(land.lawn, 1) : field(0, 0);
    f.g.fillRect(i * cell, j * cell, cell, cell);
  }
  // Soft edges (a lawn's edge isn't a ruled line)
  const soft = (c: HTMLCanvasElement, px: number) => {
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const g = out.getContext("2d")!;
    g.filter = `blur(${px}px)`;
    g.drawImage(c, 0, 0);
    return out;
  };
  return { field: soft(f.c, Math.max(0.6, scale * 1.2)), color: soft(t.c, Math.max(1, scale * 3)), rect: { x: 0, y: 0, width, height } };
};

/** The ground's heights at the ground mesh's own vertices (see viewport/ground: draped). */
export const grassTerrain = (doc: ViewDoc): GrassTerrain => {
  const { width, height } = doc.canvas;
  const grid = doc.gridSize || 20;
  const nx = Math.max(1, Math.round(width / grid)), ny = Math.max(1, Math.round(height / grid));
  const cols = nx + 1, rows = ny + 1;
  const heights = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) heights[j * cols + i] = heightAt(doc.heights, doc.gridSize, (i / nx) * width, (j / ny) * height);
  }
  return { heights, cols, rows, x: 0, y: 0, width, height };
};
