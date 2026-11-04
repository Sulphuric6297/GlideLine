// What shows over a flyover, the same in a recording and on screen: the hole's badge in the
// corner, its big title as the flight starts, the basket marker with the distance left, and the
// course's name.
import { TEE_LEVELS } from "../constants";
import { flyoverOf } from "../lib/flight";
import { loadFont } from "../lib/fontLoad";
import { holeStats } from "../lib/holeStats";
import { cardStyle } from "../lib/teeSign";
import { fmtDist, fmtElev } from "../lib/units";
import type { CourseDoc, FlyoverSettings } from "../types";

/** Where the basket is in a frame (pixels, or null when out of the picture) and how far it is (ft). */
export type FrameInfo = { basket: { x: number; y: number } | null; toBasket: number };

/** What the overlay shows (as the flyover settings say). */
export type OverlayShow = Pick<FlyoverSettings, "title" | "badge" | "pinDistance" | "courseName">;

/** `head`: the course's headings font (the tee signs'), as a font stack, and `font` its name;
 * `header` and `accent`: the signs' header colors (the badge's fill and its second line). */
export type HoleTitle = { number: string; name: string; par: string; length: string; elevation: string; color: string; ink: string; show: OverlayShow; head: string; font: string; header: string; accent: string };

/** What a hole's flyover overlay shows. */
export const overlayShow = (doc: CourseDoc, holeId: string): OverlayShow => {
  const f = flyoverOf(doc, doc.holes.find(h => h.id === holeId));
  return { title: f.title, badge: f.badge, pinDistance: f.pinDistance, courseName: f.courseName };
};

export const holeTitle = (doc: CourseDoc, holeId: string): HoleTitle => {
  const hole = doc.holes.find(h => h.id === holeId)!;
  const s = holeStats(doc, hole);
  const lvl = TEE_LEVELS[s.level];
  const card = cardStyle(doc);
  // (a Google font fetched, if it is one: ready by the time the title shows, as a rule)
  loadFont(card.font);
  return {
    number: s.label, name: hole.name ?? "", par: `PAR ${s.par}`, length: fmtDist(s.length, doc.units).toUpperCase(), elevation: Math.abs(s.elevationChange) >= 1 ? fmtElev(s.elevationChange, doc.units).toUpperCase() : "",
    color: lvl.color, ink: lvl.ink, show: overlayShow(doc, holeId), head: card.head, font: card.font, header: card.header, accent: card.accent
  };
};

/** `#rrggbb` as `rgba(…, a)`. */
const alpha = (hex: string, a: number) => {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#13311d";
  return `rgba(${[1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(",")},${a})`;
};

/** Writes `text` centered at (x, y), its font made smaller (from `px`) until it fits `max` wide. */
const fitText = (g: CanvasRenderingContext2D, text: string, x: number, y: number, weight: number, px: number, family: string, max: number) => {
  g.font = `${weight} ${Math.round(px)}px ${family}`;
  const w = g.measureText(text).width;
  if (w > max) g.font = `${weight} ${Math.max(8, Math.floor((px * max) / w))}px ${family}`;
  g.fillText(text, x, y);
};

const roundRect = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
};

/** The headings font when a title doesn't name one. */
const HEAD = "Oswald, 'Arial Narrow', Arial, sans-serif";
const BODY = "Inter, Arial, sans-serif";

/** Over the picture: the hole's badge in the corner, its big title as the flight starts, the
 * basket marker with the distance left, and the course's name. */
export const drawOverlay = (g: CanvasRenderingContext2D, w: number, h: number, hole: HoleTitle, title: number, info: FrameInfo | null, doc: CourseDoc, foot = 0) => {
  const u = h / 720;
  // (the course's headings font, the tee signs')
  const head = hole.head || HEAD;
  g.save();
  g.textBaseline = "middle";
  // The basket, with the distance still to fly (once the big title has gone)
  if (hole.show.pinDistance && info?.basket && (title < 0.95 || !hole.show.title)) {
    g.globalAlpha = hole.show.title ? 1 - title : 1;
    const label = fmtDist(info.toBasket, doc.units);
    g.font = `700 ${Math.round(17 * u)}px ${BODY}`;
    const tw = g.measureText(label).width;
    const bx = info.basket.x, by = info.basket.y;
    g.shadowColor = "rgba(0,0,0,.5)";
    g.shadowBlur = 6 * u;
    g.fillStyle = doc.style.basket;
    roundRect(g, bx - tw / 2 - 11 * u, by - 52 * u, tw + 22 * u, 28 * u, 14 * u);
    g.fill();
    g.beginPath();
    g.moveTo(bx - 9 * u, by - 18 * u);
    g.lineTo(bx + 9 * u, by - 18 * u);
    g.lineTo(bx, by - 4 * u);
    g.closePath();
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = "#111111";
    g.textAlign = "center";
    g.fillText(label, bx, by - 38 * u);
    g.globalAlpha = 1;
  }
  // The hole's badge, top left
  if (hole.show.badge) {
    const r = 30 * u, x0 = 28 * u, y0 = 28 * u;
    g.font = `700 ${Math.round(28 * u)}px ${head}`;
    const line1 = `HOLE ${hole.number}`;
    const line2 = `${hole.par} · ${hole.length}`;
    const bw = Math.max(g.measureText(line1).width, (g.font = `600 ${Math.round(18 * u)}px ${head}`, g.measureText(line2).width)) + 2 * r + 46 * u;
    g.fillStyle = alpha(hole.header, 0.82);
    roundRect(g, x0, y0, bw, 2 * r + 20 * u, r + 10 * u);
    g.fill();
    const cx = x0 + 10 * u + r, cy = y0 + 10 * u + r;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = hole.color;
    g.fill();
    g.lineWidth = 3 * u;
    g.strokeStyle = "#ffffff";
    g.stroke();
    g.fillStyle = hole.ink;
    g.textAlign = "center";
    g.font = `700 ${Math.round(30 * u)}px ${head}`;
    g.fillText(String(hole.number), cx, cy + 1 * u);
    g.textAlign = "left";
    g.fillStyle = "#ffffff";
    g.font = `700 ${Math.round(28 * u)}px ${head}`;
    g.fillText(line1, cx + r + 14 * u, cy - 12 * u);
    g.font = `600 ${Math.round(18 * u)}px ${head}`;
    g.fillStyle = hole.accent;
    g.fillText(line2, cx + r + 14 * u, cy + 16 * u);
  }
  // The course, bottom right
  if (hole.show.courseName && doc.name) {
    g.font = `600 ${Math.round(15 * u)}px ${BODY}`;
    g.textAlign = "right";
    g.fillStyle = "rgba(255,255,255,.85)";
    g.shadowColor = "rgba(0,0,0,.7)";
    g.shadowBlur = 4 * u;
    // (on screen, above the bar over the view's foot: `foot`)
    g.fillText(doc.name, w - 24 * u, h - 24 * u - foot);
    g.shadowBlur = 0;
  }
  // The big title as the flight starts
  if (hole.show.title && title > 0.01) {
    g.globalAlpha = title;
    const grad = g.createLinearGradient(0, h * 0.25, 0, h * 0.75);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.5, "rgba(0,0,0,.45)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, h * 0.25, w, h * 0.5);
    g.textAlign = "center";
    g.fillStyle = "#ffffff";
    g.shadowColor = "rgba(0,0,0,.6)";
    g.shadowBlur = 10 * u;
    if (hole.show.courseName && doc.name) {
      g.font = `600 ${Math.round(20 * u)}px ${BODY}`;
      g.fillText(doc.name.toUpperCase(), w / 2, h * 0.37);
    }
    // (a long name made smaller until it fits nine tenths of the width)
    fitText(g, hole.name ? `${hole.number} · ${hole.name.toUpperCase()}` : `HOLE ${hole.number}`, w / 2, h * 0.49, 700, 96 * u, head, w * 0.9);
    g.fillStyle = hole.accent;
    fitText(g, [hole.par, hole.length, hole.elevation].filter(Boolean).join("  ·  "), w / 2, h * 0.61, 600, 34 * u, head, w * 0.9);
  }
  g.restore();
};

