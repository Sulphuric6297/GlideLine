// Where this tab was: in a course (which one, on which step and printout), or on the course list.
// Kept for the tab only (its session storage), so a refresh comes back to it; a new tab or window
// starts at the course list as before.

export type Place = { course: string; step: "site" | "design" | "map" | "export"; tab: "general" | "map" | "sign" | "page" | "scorecard" };

const KEY = "dg.place";

/** Where the tab was when the page was last left (null: on the course list, or a fresh tab). */
export const placeBefore: Place | null = (() => {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    return v && typeof v.course === "string" && v.step ? (v as Place) : null;
  } catch {
    return null;
  }
})();

let kept = JSON.stringify(placeBefore);
/** Where the tab is now (null: the course list). */
export const keepPlace = (p: Place | null) => {
  const v = JSON.stringify(p);
  if (v === kept) return;
  kept = v;
  try { if (p) sessionStorage.setItem(KEY, v); else sessionStorage.removeItem(KEY); } catch { /* private window */ }
};
