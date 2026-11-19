// Where walls meet. A dry stone wall drawn up to another wall (its end on the other wall, a foot
// short of it or up to a yard out its far side) stops at that wall's face, a few inches in, and is laid as a run there,
// not squared off as a wall head: so two walls' stones never lie through each other. Two walls
// drawn from the same corner: one runs through to the corner's outside and the other stops
// against it.
import type { CourseItem, LineItem, P } from "../types";
import { distanceToPath } from "./geom";
import { isWall, linePath, wallThick } from "./course";

/** How far into the other wall a wall that meets it is tucked, ft. */
const TUCK = 0.25;
/** How far short of the other wall's face an end can be drawn and still meet it, ft. */
const NEAR = 1;
/** How far out the other wall's far side an end can be drawn and still be a wall meeting it (not
 * one crossing it), ft. */
const THROUGH = 3;

/** `pts` cut back from its last point, through the other wall, to where it comes out `reach` ft
 * from the line `other` on its own side (null: within `limit` ft it never goes into the other
 * wall and out again, so it's left alone). */
const cutBack = (pts: P[], other: P[], reach: number, limit: number): P[] | null => {
  let walked = 0, inside = false;
  for (let i = pts.length - 1; i > 0; i--) {
    const a = pts[i], b = pts[i - 1], len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let d = 0; d <= len; d += 0.2) {
      const q = { x: a.x + ((b.x - a.x) * d) / (len || 1), y: a.y + ((b.y - a.y) * d) / (len || 1) };
      const far = distanceToPath(q, other) >= reach;
      if (far && inside) return [...pts.slice(0, i), q];
      if (!far) inside = true;
      if (walked + d > limit) return null;
    }
    walked += len;
  }
  return null;
};

/** A wall's line as it's built (`pts`: its line, drawn or curved), and which of its ends (first,
 * last) stop against another wall. */
export const wallRun = (l: LineItem, pts: P[], items: CourseItem[]): { pts: P[]; butt: [boolean, boolean] } => {
  const butt: [boolean, boolean] = [false, false];
  if (pts.length < 2) return { pts, butt };
  const others = items.filter(o => isWall(o) && o.id !== l.id && o.points.length >= 2) as LineItem[];
  if (!others.length) return { pts, butt };
  let run = pts;
  for (const end of [1, 0] as const) {
    // (worked from the line's last point: its first end is its last, the line turned round)
    const turned = end ? run : [...run].reverse(), tip = turned[turned.length - 1];
    for (const o of others) {
      const path = linePath(o), half = wallThick(o) / 2;
      const away = distanceToPath(tip, path);
      if (away > half + THROUGH) continue;
      // (drawn from the same corner: the first of the two in the course runs through, out to the
      // corner's outside; the other stops against it)
      const shared = Math.min(Math.hypot(tip.x - path[0].x, tip.y - path[0].y), Math.hypot(tip.x - path[path.length - 1].x, tip.y - path[path.length - 1].y)) < 0.5;
      if (shared && items.indexOf(l) < items.indexOf(o)) {
        const b = turned[turned.length - 2], len = Math.hypot(tip.x - b.x, tip.y - b.y) || 1;
        const out = [...turned.slice(0, -1), { x: tip.x + ((tip.x - b.x) / len) * half, y: tip.y + ((tip.y - b.y) / len) * half }];
        run = end ? out : out.reverse();
        break;
      }
      // (its end carried on a little, so one drawn just short of the other wall still reaches it)
      const b = turned[turned.length - 2], len = Math.hypot(tip.x - b.x, tip.y - b.y) || 1, on = half + NEAR;
      const longer = [...turned.slice(0, -1), tip, { x: tip.x + ((tip.x - b.x) / len) * on, y: tip.y + ((tip.y - b.y) / len) * on }];
      // (drawn through the other wall and a little out its far side: cut back to the near face;
      // or drawn on it or just short of it)
      const reach = Math.max(0.1, half - TUCK);
      const cut = cutBack(turned, path, reach, half * 2 + THROUGH + 0.5) ?? (away <= half + NEAR ? cutBack(longer, path, reach, on + half * 4 + 4) : null);
      if (!cut || cut.length < 2) continue;
      run = end ? cut : [...cut].reverse();
      butt[end ? 1 : 0] = true;
      break;
    }
  }
  return { pts: run, butt };
};
