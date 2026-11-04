// The public course page, for anyone with a link (#site=…): no account. It shows only what the
// owner published and the link allows: the course map, its numbers and holes, tee signs, the
// scorecard, downloads, and the course to look round in 3D when allowed.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { Check, ChevronLeft, ChevronRight, Download, Grid3x3, Loader2, Lock, Map as MapIcon, Maximize2, Mountain, Play, Share, X, ZoomIn } from "lucide-react";
import { Loading, LoadingScreen } from "../components/ui";
import { normalizeCourse } from "../lib/course";
import { safeDoc } from "../lib/safeDoc";
import { fmtDist, fmtElev } from "../lib/units";
import { useCourse, useEditor } from "../state/course";
import { show } from "../state/files";
import { getView, onLiveView } from "../state/view";
import type { CourseDoc, Units } from "../types";
import { Logo } from "./parts";
import { Woods } from "../components/Woods";
import { holeFacts, type HoleNumbers } from "./holeFacts";
import { countHole, countVisit } from "./visits";
import { useServerCourse } from "./courses";

// (a link's random address or the name its owner gave it: …/springfield-park, or …#site=…)
export const SITE_TOKEN = /^\/([a-z0-9][a-z0-9-]{2,39}|[A-Za-z0-9_-]{40,})\/?$/.exec(location.pathname)?.[1] ?? /^#site=([A-Za-z0-9_-]{3,})$/.exec(location.hash)?.[1] ?? null;

/** Back from the 3D view or the map to the course page (set while they're open). */
const usePublicBack = create<{ back: (() => void) | null }>(() => ({ back: null }));

/** The way back to the course page, at the left of the view's top bar like a back button. */
export function CoursePageButton() {
  const back = usePublicBack(s => s.back);
  if (!back) return null;
  return (
    <button className="shrink-0 inline-flex items-center gap-0.5 h-[34px] pl-1.5 pr-3 rounded-full bg-white/[0.1] hover:bg-white/[0.16] text-sm font-semibold text-zinc-50" onClick={back} data-testid="leave-3d">
      <ChevronLeft size={18} /> Course page
    </button>
  );
}

interface Site {
  info: { name: string; designer?: string; units?: Units; totals?: { holes: number; par: number; length: number; climb: number }; holes: (HoleNumbers & { id?: string; label: string; name: string; line?: [number, number][] })[] };
  shown: Record<string, boolean>;
  publishedAt: string;
  hasCourse: boolean;
  files: string[];
}

/** The pictures shown on the page, each in one format (the lighter one when there are two). */
const pictures = (files: string[]) => {
  const pics = files.filter(n => /\.(webp|png|jpeg)$/.test(n) && !n.startsWith("photo."));
  return pics.filter(n => !(n.endsWith(".png") && pics.includes(n.replace(/\.png$/, ".webp"))));
};
/** The course page's own parts first: the map, then the signs and the card. */
const byNeed = (n: string) => (n.startsWith("map.") ? 0 : n.startsWith("sign-") ? 1 : 2);

const get = async (path: string, password: string) => {
  const res = await fetch(`./api/public/${SITE_TOKEN}${path}`, { headers: password ? { "x-link-password": password } : {} });
  return res;
};

export function PublicSite({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<Site | null>(null);
  const [error, setError] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [tried, setTried] = useState("");
  const [files, setFiles] = useState<Record<string, string>>({});
  const [explore, setExplore] = useState(false);
  // (the course on its way to the 3D view or the map, and once there, until it's drawn)
  const [opening, setOpening] = useState<"3d" | "map" | null>(null);
  const [openError, setOpenError] = useState("");
  const [drawn, setDrawn] = useState(false);
  // (a file on its way down)
  const [fetching, setFetching] = useState("");
  const [big, setBig] = useState<string | null>(null);
  // (a tee sign big, among all of them: stepped through; and all of them in a grid)
  const [bigSign, setBigSign] = useState<number | null>(null);
  const [allSigns, setAllSigns] = useState(false);
  const [openHole, setOpenHole] = useState<string | null>(null);
  const wide = useWide();
  // (the hole picked: its row brought into view in the list. On a phone, into the middle of the
  // room between the map pinned at the top and the bar at the bottom, once it has opened)
  const openRow = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const row = openRow.current;
    if (!row) return;
    if (wide) { row.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); return; }
    const raf = requestAnimationFrame(() => {
      const top = document.querySelector('[data-testid="map-pinned"]')?.getBoundingClientRect().bottom ?? 0;
      const bar = document.querySelector('[data-testid="public-bar"]')?.getBoundingClientRect().top ?? innerHeight;
      const r = row.getBoundingClientRect(), room = bar - top - 16;
      // (centred when it fits; its top just under the map when it's taller than the room)
      const want = r.height <= room ? top + 8 + (room - r.height) / 2 : top + 8;
      window.scrollBy({ top: r.top - want, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [openHole, wide]);

  const load = async (pw: string) => {
    const res = await get("", pw);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.needsPassword) { setNeedsPassword(true); setTried(pw ? "Wrong password" : ""); return; }
    if (!res.ok) { setError(data.error ?? "This link doesn't work"); return; }
    setNeedsPassword(false);
    setSite(data);
    // (this visit counted: no cookies, nothing kept here; auth/visits)
    void countVisit(SITE_TOKEN!, pw);
    // Pictures through the link (the password goes with each), each shown as it comes: the map
    // first, then the rest a few at a time
    const one = async (name: string) => {
      const f = await get(`/files/${name}`, pw);
      if (f.ok) { const url = URL.createObjectURL(await f.blob()); setFiles(o => ({ ...o, [name]: url })); }
    };
    const queue = pictures(data.files as string[]).sort((a, b) => byNeed(a) - byNeed(b));
    await Promise.all(queue.filter(n => byNeed(n) === 0).map(one));
    const rest = queue.filter(n => byNeed(n) > 0);
    await Promise.all(Array.from({ length: 4 }, async () => { for (let n = rest.shift(); n; n = rest.shift()) await one(n); }));
    // (the 3D view's code fetched meanwhile, ready for Explore)
    if (data.hasCourse) setTimeout(() => { void import("../App").catch(() => {}); void import("../three/ezShapes").catch(() => {}); }, 1500);
  };
  // (the page couldn't be had: said so, not left loading)
  const [checking, setChecking] = useState(false);
  const tryLoad = async (pw: string) => {
    setChecking(true);
    try { await load(pw); } catch { setError("This course page couldn't be loaded. Check the connection and reload"); } finally { setChecking(false); }
  };
  useEffect(() => { void tryLoad(""); }, []);
  // (a hole opened on the page: counted for the course's visitor stats)
  useEffect(() => {
    const h = openHole ? site?.info.holes.find(x => (x.id ?? x.label) === openHole) : null;
    if (h) countHole(h.label);
  }, [openHole]);

  /** The course to look round (and a hole's flyover, when one is asked for). */
  const open3d = async (flyHole?: string) => {
    if (opening) return;
    setOpenError("");
    setOpening(site!.shown.view3d || flyHole ? "3d" : "map");
    setDrawn(false);
    try {
      await openCourse(flyHole);
    } catch {
      setOpenError("The course couldn't be opened. Check the connection and try again.");
      setOpening(null);
    }
  };
  const openCourse = async (flyHole?: string) => {
    const res = await get("/course", password);
    if (!res.ok) throw new Error("no course");
    const { doc } = await res.json() as { doc: CourseDoc };
    let background: string | null = null;
    const photo = site!.files.find(f => f.startsWith("photo."));
    if (photo) {
      const f = await get(`/files/${photo}`, password);
      if (f.ok) {
        const b = await f.blob();
        background = await new Promise<string>(ok => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(b); });
      }
    }
    const d = normalizeCourse(safeDoc({ ...doc, background }));
    useServerCourse.setState({ role: "viewer", perms: { ...site!.shown, copy: false, downloads: false, comments: false } as never, id: null });
    useCourse.setState({ readOnly: true });
    show(d);
    useEditor.getState().set({ view: site!.shown.view3d && !site!.shown.map ? "3d" : "2d" });
    setExplore(true);
    // (straight down the hole from its tee)
    if (flyHole && d.holes.some(h => h.id === flyHole)) setTimeout(() => useEditor.getState().set({ view: "3d", teeView: flyHole, flyover: true }), 400);
  };

  // Opened: the view up and its first frames drawn before the wait goes
  useEffect(() => {
    if (!explore) return;
    let raf = 0;
    const up = (v: unknown) => { if (v) raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => setDrawn(true)); }); };
    // (already up when the editor's code was loaded before: a second visit)
    const stop = onLiveView(up);
    up(getView());
    return () => { stop(); cancelAnimationFrame(raf); };
  }, [explore]);
  useEffect(() => { if (drawn) setOpening(null); }, [drawn]);
  useEffect(() => {
    usePublicBack.setState({ back: explore ? () => setExplore(false) : null });
    return () => usePublicBack.setState({ back: null });
  }, [explore]);

  if (explore) {
    return (
      <>
        {children}
        {!drawn && <Opening what={opening ?? "3d"} />}
      </>
    );
  }
  if (error) return <Plain><p className="text-zinc-300">{error}.</p></Plain>;
  if (needsPassword) {
    return (
      <Plain>
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!checking) void tryLoad(password); }}>
          <div className="flex items-center gap-2 text-zinc-200"><Lock size={16} /> This course page has a password.</div>
          <input type="password" className="w-full bg-white/[0.07] rounded-lg px-3 py-2 text-zinc-100" value={password} onChange={e => setPassword(e.target.value)} aria-label="Password" autoFocus />
          {tried && <p role="alert" className="text-sm text-red-300">{tried}</p>}
          <button className="w-full rounded-lg px-3 py-2 font-semibold bg-orange-500 text-zinc-950 inline-flex items-center justify-center gap-2 disabled:opacity-80" disabled={checking}>{checking && <Loader2 size={15} className="animate-spin" />}{checking ? "Opening…" : "Open"}</button>
        </form>
      </Plain>
    );
  }
  if (!site) return <LoadingScreen label="Loading the course…" />;

  const u = site.info.units ?? "ft";
  // (each hole's flyover, when the link shows flyovers and the course)
  const flies = site.hasCourse && !!site.shown.flyovers;
  const t = site.info.totals;
  const shownPics = pictures(site.files);
  const signs = shownPics.filter(n => n.startsWith("sign-")).sort((a, b) => parseInt(a.slice(5)) - parseInt(b.slice(5)));
  const mapName = shownPics.find(n => n.startsWith("map."));
  const map = mapName ? files[mapName] : undefined;
  const cardName = shownPics.find(n => n.startsWith("scorecard."));
  const card = cardName ? files[cardName] : undefined;
  const holes = site.info.holes;
  // (a tee sign's hole, by its label: "sign-3.webp" is the third hole's)
  const signLabel = (n: string) => holes[parseInt(n.slice(5)) - 1]?.label ?? n.slice(5).split(".")[0];
  const showHoles = !!site.shown.stats && holes.length > 0;
  const downloads = site.files.filter(f => /\.(gpx|kml)$/.test(f));
  const download = async (name: string) => {
    setFetching(name);
    const f = await get(`/files/${name}`, password).catch(() => null).finally(() => setFetching(""));
    if (!f?.ok) { setOpenError("That file couldn't be downloaded. Try again."); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await f.blob());
    a.download = `${(site.info.name || "course").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${name.split(".").pop()}`;
    a.click();
  };
  /** A hole's tee sign (the signs are numbered in the holes' order). */
  const signOf = (k: number) => signs.find(n => parseInt(n.slice(5)) === k + 1);
  const pickedAt = holes.findIndex(h => (h.id ?? h.label) === openHole);
  const pick = (id: string | null) => setOpenHole(o => (o === id ? null : id));

  const exploreBtn = site.hasCourse && (
    <button className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-[13.5px] font-semibold bg-[#a7d46f] hover:bg-[#b6dd83] text-[#14230d] disabled:opacity-80" onClick={() => void open3d()} disabled={!!opening} aria-busy={!!opening || undefined} data-testid="explore">
      {opening ? <Loader2 size={15} className="animate-spin" /> : site.shown.view3d ? <Mountain size={15} /> : <MapIcon size={15} />} {opening ? "Opening…" : site.shown.view3d ? "Explore in 3D" : "Explore the map"}
    </button>
  );
  const scorecard = cardName && (
    <button className={`${PILL} ${card ? "" : "opacity-60"}`} disabled={!card} onClick={() => card && setBig(card)} data-testid="public-scorecard">Scorecard</button>
  );
  const totals = t && site.shown.stats && (
    <dl className="flex gap-5 my-3" data-testid="public-totals">
      {[["holes", String(t.holes)], ["par", String(t.par)], ["long", fmtDist(t.length, u)], ...(t.climb ? [["of climb", fmtElev(t.climb, u).replace(/^[+−-]/, "")]] : [])].map(([k, v]) => (
        <div key={k}><dd className="text-[19px] font-bold tracking-[-0.02em] text-zinc-50 leading-tight">{v}</dd><dt className="text-[11px] text-zinc-400">{k}</dt></div>
      ))}
    </dl>
  );
  const holeList = showHoles && (
    <section className="mt-4">
      <h2 className="text-[12px] font-semibold text-zinc-400 mb-1.5 px-1">Holes</h2>
      <ul className="rounded-[16px] bg-white/[0.07] overflow-hidden" data-testid="public-holes">
        {holes.map((h, k) => {
          const id = h.id ?? h.label, on = openHole === id, sign = signOf(k);
          return (
            <li key={h.label} data-testid="public-hole" className={on ? "bg-white/[0.1]" : k ? "border-t border-white/[0.07]" : ""} ref={on ? openRow : undefined}>
              <button className="w-full flex items-center gap-2.5 px-3 py-2.5 touch:py-3 text-left hover:bg-white/[0.05]" onClick={() => pick(id)} aria-expanded={on}>
                <span className={`min-w-[26px] h-[26px] px-1 rounded-full font-bold text-[12px] flex items-center justify-center shrink-0 ${on ? "bg-[#a7d46f] text-[#14230d]" : "bg-blue-600 text-white"}`}>{h.label}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13.5px] font-semibold text-zinc-50 truncate">{h.name || fmtDist(h.length, u)}</span>
                  <span className="block text-[12px] text-zinc-400">{h.name ? `${fmtDist(h.length, u)} · ` : ""}{fmtElev(h.elevation, u)}</span>
                </span>
                <span className={`text-[12.5px] font-semibold ${on ? "text-zinc-100" : "text-zinc-400"}`}>Par {h.par}</span>
              </button>
              {on && (
                <div className="px-3 pb-3 pl-[46px]">
                  <div className="flex gap-2.5 items-center">
                    {sign && files[sign] && <button className="shrink-0 rounded-[10px] overflow-hidden ring-1 ring-white/20" onClick={() => setBigSign(signs.indexOf(sign))} aria-label={`Tee sign, hole ${h.label}, bigger`}><img src={files[sign]} alt="" className="w-[104px] h-[70px] object-cover" /></button>}
                    <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                      {flies && h.id && <button className="inline-flex items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[12.5px] font-semibold bg-[#a7d46f] hover:bg-[#b6dd83] text-[#14230d]" onClick={() => void open3d(h.id)} data-testid="fly-hole"><Play size={12} fill="currentColor" /> Play flyover</button>}
                      {sign && files[sign] && <button className={`${PILL} !py-1.5 !text-[12.5px]`} onClick={() => setBigSign(signs.indexOf(sign))}>Tee sign</button>}
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2.5" data-testid="hole-facts">
                    {holeFacts(h, u).filter(([k]) => k !== "Par" && k !== "Length").map(([k, v]) => (
                      <div key={k}><dt className="text-[10.5px] text-zinc-500">{k}</dt><dd className="text-[12.5px] font-semibold text-zinc-100">{v}</dd></div>
                    ))}
                  </dl>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
  const signRow = signs.length > 0 && (
    <section className="mt-4">
      <div className="flex items-center mb-1.5 px-1">
        <h2 className="text-[12px] font-semibold text-zinc-400 flex-1">Tee signs <span className="text-zinc-500 font-normal">· {signs.length}</span></h2>
        {signs.length > 1 && <button className="inline-flex items-center gap-1 text-[12px] font-semibold text-zinc-200 hover:text-white" onClick={() => setAllSigns(true)} data-testid="public-signs-all"><Grid3x3 size={13} /> See all</button>}
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 dg-scroll" data-testid="public-signs">
        {signs.map((n, i) => (
          <li key={n} className="shrink-0">{files[n]
            ? <button className="block rounded-[10px] overflow-hidden ring-1 ring-white/20 animate-[dgfade_0.3s_ease_both]" onClick={() => setBigSign(i)}><img src={files[n]} alt={`Tee sign, hole ${n.slice(5).split(".")[0]}`} className="h-[84px] w-auto" loading="lazy" /></button>
            : <div className="h-[84px] w-[126px] rounded-[10px] bg-white/[0.07] animate-pulse" role="img" aria-label={`Tee sign, hole ${n.slice(5).split(".")[0]}, loading`} />}</li>
        ))}
      </ul>
    </section>
  );
  const downloadRow = downloads.length > 0 && (
    <section className="mt-4">
      <h2 className="text-[12px] font-semibold text-zinc-400 mb-1.5 px-1">Take it with you</h2>
      <div className="flex flex-wrap gap-1.5">
        {downloads.map(f => (
          <button key={f} className={PILL} disabled={fetching === f} onClick={() => void download(f)}>{fetching === f ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {f.endsWith("gpx") ? "GPS file (GPX)" : "Google Earth (KML)"}</button>
        ))}
      </div>
    </section>
  );
  const footer = <footer className="mt-6 mb-1 flex items-center gap-2 text-[11.5px] text-zinc-500"><Logo size={16} /> Made with GlideLine Studio · {new Date(site.publishedAt).toLocaleDateString()}</footer>;
  const head = (
    <div className="flex items-start gap-2.5">
      <div className="flex-1 min-w-0">
        <h1 className="text-[26px] leading-tight font-extrabold tracking-[-0.03em] text-zinc-50">{site.info.name}</h1>
        {site.info.designer && <p className="text-[12.5px] text-zinc-300 mt-0.5">Designed by {site.info.designer}</p>}
      </div>
      <ShareButton />
    </div>
  );
  const mapPane = mapName && (map
    ? <CourseMap src={map} alt={`Map of ${site.info.name}`} holes={holes.map(h => ({ id: h.id ?? h.label, line: h.line }))} picked={openHole} onPick={id => setOpenHole(id)} wide={wide} onFull={() => setBig(map)} />
    : <div className="w-full aspect-[4/3] rounded-[18px] bg-white/[0.06] flex items-center justify-center" data-testid="map-loading"><Loading label="Loading the course map…" /></div>);

  return (
    <div className="relative min-h-[100dvh] bg-zinc-950 text-zinc-100 isolate" data-testid="public-site">
      <Woods />
      {wide ? (
        // A computer: the whole map as tall as the window, everything else on glass beside it
        <div className="fixed inset-0 flex gap-3.5 p-3.5">
          <main className="flex-1 min-w-0 relative">{mapPane || <div className="h-full flex items-center justify-center text-zinc-400">{site.info.name}</div>}</main>
          <aside className="glass w-[330px] shrink-0 rounded-[26px] overflow-y-auto px-4 pt-4 pb-3" aria-label="The course">
            {head}
            {totals}
            <div className="flex gap-1.5 mt-1">{exploreBtn}{scorecard}</div>
            {openError && <p role="alert" className="mt-2 text-[12.5px] text-red-300">{openError}</p>}
            {holeList}
            {signRow}
            {downloadRow}
            {footer}
          </aside>
        </div>
      ) : (
        // A phone: the whole map across the top, staying there while the holes scroll under it
        <div className="relative pb-28">
          <header className="px-4 pt-[max(18px,env(safe-area-inset-top))] pb-2">{head}{totals}</header>
          {mapPane && <div className="sticky top-0 z-20 px-2 pt-[max(8px,env(safe-area-inset-top))] pb-2 rounded-b-[24px] bg-[rgba(11,16,11,0.55)] backdrop-blur-xl" data-testid="map-pinned">{mapPane}</div>}
          <div className="px-3">
            {openError && <p role="alert" className="mt-2 text-[12.5px] text-red-300">{openError}</p>}
            {holeList}
            {signRow}
            {downloadRow}
            {footer}
          </div>
          {(exploreBtn || scorecard) && (
            <div className="glass fixed z-30 left-3 right-3 bottom-[max(12px,env(safe-area-inset-bottom))] rounded-[26px] p-1.5 flex gap-1.5" data-testid="public-bar">{exploreBtn}{scorecard}</div>
          )}
        </div>
      )}
      {pickedAt >= 0 && <HoleKeys onStep={d => { const n = holes[(pickedAt + d + holes.length) % holes.length]; setOpenHole(n.id ?? n.label); }} onLetGo={() => setOpenHole(null)} off={!!big} />}
      {big && <Zoomable src={big} onClose={() => setBig(null)} />}
      {allSigns && (
        <div className="fixed inset-0 z-40 bg-black/90 overflow-y-auto" role="dialog" aria-label="All the tee signs" data-testid="public-signs-grid">
          <div className="sticky top-0 flex items-center gap-2 px-4 py-3 bg-black/70 backdrop-blur">
            <h2 className="flex-1 font-semibold text-zinc-100">Tee signs <span className="text-zinc-400 font-normal">· {signs.length}</span></h2>
            <button className="rounded-full w-9 h-9 glass border border-white/[0.12] text-zinc-100 flex items-center justify-center" onClick={() => setAllSigns(false)} aria-label="Close"><X size={17} /></button>
          </div>
          <ul className="grid gap-3 p-4 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
            {signs.map((n, i) => (
              <li key={n}>
                <button className="w-full text-left" onClick={() => setBigSign(i)}>
                  {files[n] ? <img src={files[n]} alt={`Tee sign, hole ${signLabel(n)}`} className="w-full rounded-[10px] ring-1 ring-white/20" loading="lazy" /> : <div className="aspect-[2/3] rounded-[10px] bg-white/[0.07] animate-pulse" />}
                  <span className="block mt-1 text-[12px] text-zinc-400">Hole {signLabel(n)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {bigSign !== null && files[signs[bigSign]] && (
        <Zoomable key={bigSign} src={files[signs[bigSign]]} onClose={() => setBigSign(null)}
          step={{ at: bigSign, of: signs.length, label: `Hole ${signLabel(signs[bigSign])}`, go: i => setBigSign((i + signs.length) % signs.length) }} />
      )}
      {opening && <Opening what={opening} />}
    </div>
  );
}

const PILL = "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-[13.5px] font-semibold bg-white/[0.12] hover:bg-white/[0.18] text-zinc-50 disabled:opacity-60";

/** A computer's keys for the hole picked: ← and → the one before or after, Esc lets it go. */
function HoleKeys({ onStep, onLetGo, off }: { onStep: (d: number) => void; onLetGo: () => void; off: boolean }) {
  useEffect(() => {
    if (off) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      if (e.key === "Escape") onLetGo();
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); onStep(e.key === "ArrowLeft" ? -1 : 1); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onStep, onLetGo, off]);
  return null;
}

/** The page's link, to send on (the phone's own share sheet, or copied). */
function ShareButton() {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = location.href;
    try {
      if (navigator.share) { await navigator.share({ url, title: document.title }); return; }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* (closed without sharing) */ }
  };
  return (
    <button className="shrink-0 mt-1 h-9 rounded-full bg-white/[0.1] hover:bg-white/[0.16] text-zinc-100 flex items-center justify-center gap-1.5 px-2.5 text-[12.5px] font-semibold" onClick={() => void share()} aria-label="Share this page" title="Share this page" data-testid="public-share">
      {copied ? <><Check size={15} /> Copied</> : <Share size={15} />}
    </button>
  );
}

const useWide = () => {
  const q = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => typeof matchMedia !== "undefined" && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
};

type Line = [number, number][];
const VW = 1000;
/** How far a point (fractions of the map) is from a hole's line, in the map's own width. */
const offLine = (p: { x: number; y: number }, line: Line, aspect: number) => {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const ax = line[i][0], ay = line[i][1] / aspect, bx = line[i + 1][0], by = line[i + 1][1] / aspect, py = p.y / aspect;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
    const f = Math.max(0, Math.min(1, ((p.x - ax) * dx + (py - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(p.x - (ax + dx * f), py - (ay + dy * f)));
  }
  return best;
};

/**
 * The whole course map, never cropped: as big as its space allows (`wide`), or the width of the
 * screen. Scroll, pinch or double-tap to look closer, drag to look round; ⤢ full screen. A hole
 * picked gets a pool of warm light on it (nothing else on the map changes), and "Go in close"
 * goes to it, "All of it" back out. Tapping a hole on the map picks it.
 */
function CourseMap({ src, alt, holes, picked, onPick, wide, onFull }: { src: string; alt: string; holes: { id: string; line?: Line }[]; picked: string | null; onPick: (id: string | null) => void; wide: boolean; onFull: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(4 / 3);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [v, setV] = useState({ k: 1, x: 0, y: 0 });
  const [glide, setGlide] = useState(false);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ k: number; x: number; y: number; d: number; cx: number; cy: number; moved: boolean } | null>(null);
  const lastTap = useRef(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setSize(wide ? (r.width / r.height > aspect ? { w: r.height * aspect, h: r.height } : { w: r.width, h: r.width / aspect }) : { w: r.width, h: r.width / aspect });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect, wide]);
  // (kept over the map: no gap at its edges)
  const hold = (o: { k: number; x: number; y: number }) => {
    const mx = ((o.k - 1) * size.w) / 2, my = ((o.k - 1) * size.h) / 2;
    return { k: o.k, x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
  };
  const centreOf = () => { const r = box.current!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const zoomAt = (k2: number, cx: number, cy: number) => setV(o => {
    const k = Math.max(1, Math.min(8, k2)), c = centreOf();
    const ox = cx - c.x, oy = cy - c.y;
    return k === 1 ? { k: 1, x: 0, y: 0 } : hold({ k, x: ox - ((ox - o.x) * k) / o.k, y: oy - ((oy - o.y) * k) / o.k });
  });
  const ease = (next: { k: number; x: number; y: number }) => { setGlide(true); setV(hold(next)); setTimeout(() => setGlide(false), 420); };
  const line = holes.find(h => h.id === picked)?.line;
  const close = () => {
    if (!line || !size.w) return;
    const xs = line.map(p => p[0]), ys = line.map(p => p[1]);
    const fx = (Math.min(...xs) + Math.max(...xs)) / 2, fy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max((Math.max(...xs) - Math.min(...xs)) * size.w, (Math.max(...ys) - Math.min(...ys)) * size.h, 60);
    const k = Math.max(1.5, Math.min(5, (Math.min(size.w, size.h) * 0.62) / span));
    ease({ k, x: -(fx - 0.5) * size.w * k, y: -(fy - 0.5) * size.h * k });
  };
  const centre = () => { const a = [...pts.current.values()]; return { x: a.reduce((s, p) => s + p.x, 0) / a.length, y: a.reduce((s, p) => s + p.y, 0) / a.length, d: a.length > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0 }; };
  // (a tap: the hole under it, or none)
  const tapAt = (cx: number, cy: number) => {
    const c = centreOf();
    const p = { x: ((cx - c.x - v.x) / v.k + size.w / 2) / size.w, y: ((cy - c.y - v.y) / v.k + size.h / 2) / size.h };
    let best: string | null = null, bestD = 0.035 / v.k;
    for (const h of holes) if (h.line && h.line.length >= 2) { const d = offLine(p, h.line, aspect); if (d < bestD) { bestD = d; best = h.id; } }
    onPick(best);
  };
  const VH = VW / aspect;
  const chip = "glass rounded-full px-3 py-1.5 text-[12px] font-semibold text-zinc-50 flex items-center gap-1.5";
  return (
    <div ref={box} className={`relative ${wide ? "h-full" : ""} flex items-center justify-center`} style={wide ? undefined : { height: size.h || undefined }}>
      <div className="relative overflow-hidden rounded-[18px] ring-1 ring-white/15 shadow-2xl shadow-black/50 touch-none select-none" style={{ width: size.w || "100%", height: size.h || undefined }}
        data-testid="course-map"
        onWheel={e => { if (wide) zoomAt(v.k * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); }}
        onPointerDown={e => {
          if ((e.target as HTMLElement).closest("button")) return;
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const c = centre();
          start.current = { ...v, d: c.d, cx: c.x, cy: c.y, moved: false };
        }}
        onPointerMove={e => {
          if (!pts.current.has(e.pointerId) || !start.current) return;
          pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const s0 = start.current, c = centre();
          if (Math.hypot(c.x - s0.cx, c.y - s0.cy) > 6 || (c.d && s0.d && Math.abs(c.d - s0.d) > 6)) s0.moved = true;
          if (c.d && s0.d) {
            const k = Math.max(1, Math.min(8, (s0.k * c.d) / s0.d)), m = centreOf();
            const ox = s0.cx - m.x, oy = s0.cy - m.y;
            setV(hold({ k, x: ox - ((ox - s0.x) * k) / s0.k + (c.x - s0.cx), y: oy - ((oy - s0.y) * k) / s0.k + (c.y - s0.cy) }));
          } else if (s0.k > 1) setV(hold({ k: s0.k, x: s0.x + (c.x - s0.cx), y: s0.y + (c.y - s0.cy) }));
        }}
        onPointerUp={e => {
          if (!pts.current.has(e.pointerId)) return;
          pts.current.delete(e.pointerId);
          const s0 = start.current;
          if (pts.current.size) { const c = centre(); start.current = { ...v, d: c.d, cx: c.x, cy: c.y, moved: true }; return; }
          start.current = null;
          if (s0?.moved) return;
          // (a double tap goes in there, or back out; a single one picks the hole there)
          const now = Date.now(), x = e.clientX, y = e.clientY;
          if (now - lastTap.current < 300) { lastTap.current = 0; zoomAt(v.k > 1 ? 1 : 2.5, x, y); return; }
          lastTap.current = now;
          setTimeout(() => { if (lastTap.current === now) tapAt(x, y); }, 260);
        }}
        onPointerCancel={e => { pts.current.delete(e.pointerId); start.current = null; }}>
        <div className={`absolute inset-0 origin-center will-change-transform ${glide ? "transition-transform duration-[400ms] ease-out" : ""}`} style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.k})` }}>
          <img src={src} alt={alt} draggable={false} className="block w-full h-full" onLoad={e => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setAspect(i.naturalWidth / i.naturalHeight); }} />
          {/* A pool of warm light on the hole picked, fading into the map round it */}
          {line && line.length >= 2 && (
            <svg key={picked} className="absolute inset-0 w-full h-full pointer-events-none animate-[dgfade_0.35s_ease_both]" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" aria-hidden data-testid="hole-light">
              <defs>
                <filter id="pl-soft" filterUnits="userSpaceOnUse" x="0" y="0" width={VW} height={VH}><feGaussianBlur stdDeviation="12" /></filter>
                <mask id="pl-pool" maskUnits="userSpaceOnUse" x="0" y="0" width={VW} height={VH}>
                  <polyline points={line.map(p => `${p[0] * VW},${p[1] * VH}`).join(" ")} fill="none" stroke="#fff" strokeWidth="84" strokeLinecap="round" strokeLinejoin="round" filter="url(#pl-soft)" />
                </mask>
              </defs>
              <rect width={VW} height={VH} fill="#fff3c4" opacity="0.26" mask="url(#pl-pool)" />
            </svg>
          )}
        </div>
        <div className="absolute right-2 bottom-2 flex gap-1.5">
          {line && v.k === 1 && <button className={chip} onClick={close} data-testid="map-close-in"><ZoomIn size={14} /> Go in close</button>}
          {v.k > 1 && <button className={chip} onClick={() => ease({ k: 1, x: 0, y: 0 })} data-testid="map-all">All of it</button>}
          <button className={`${chip} !px-2`} onClick={onFull} aria-label="The course map, full screen" title="Full screen"><Maximize2 size={14} /></button>
        </div>
      </div>
    </div>
  );
}

/** The course on its way to the 3D view or the map: from the click until it's drawn. */
const Opening = ({ what }: { what: "3d" | "map" }) => (
  <div className="fixed inset-0 z-[60] bg-zinc-950/90 backdrop-blur-sm flex items-center justify-center animate-[dgfade_0.2s_ease_both]" data-testid="opening-course">
    <Loading label={what === "map" ? "Opening the map…" : "Opening the course in 3D…"} />
  </div>
);

const Plain = ({ children }: { children: ReactNode }) => (
  <div className="relative min-h-[100dvh] bg-zinc-950 flex items-center justify-center p-4 isolate">
    <Woods />
    <div className="w-full max-w-sm glass rounded-[24px] p-6">
      <div className="flex items-center gap-2 mb-4"><Logo size={28} /><span className="font-bold text-zinc-50">GlideLine Studio</span></div>
      {children}
    </div>
  </div>
);

/** A picture full screen: pinch, wheel or double-tap to zoom, drag to look round, tap or Esc to close. */
/** A picture, big: pinch, wheel or double-tap to zoom. `step`: one of a set (the tee signs), with
 * ← → (buttons, keys, a swipe) to the others. */
function Zoomable({ src, onClose, step }: { src: string; onClose: () => void; step?: { at: number; of: number; label: string; go: (i: number) => void } }) {
  const [v, setV] = useState({ k: 1, x: 0, y: 0 });
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ k: number; x: number; y: number; d: number; cx: number; cy: number; moved: boolean } | null>(null);
  const lastTap = useRef(0);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (step && e.key === "ArrowRight") step.go(step.at + 1);
      else if (step && e.key === "ArrowLeft") step.go(step.at - 1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, step]);
  const clamp = (k: number) => Math.max(1, Math.min(8, k));
  const zoomAt = (k2: number, cx: number, cy: number) => setV(o => {
    const k = clamp(k2);
    const ox = cx - innerWidth / 2, oy = cy - innerHeight / 2;
    return k === 1 ? { k: 1, x: 0, y: 0 } : { k, x: ox - ((ox - o.x) * k) / o.k, y: oy - ((oy - o.y) * k) / o.k };
  });
  const centre = () => { const a = [...pts.current.values()]; return { x: a.reduce((s, p) => s + p.x, 0) / a.length, y: a.reduce((s, p) => s + p.y, 0) / a.length, d: a.length > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0 }; };
  return (
    <div className="fixed inset-0 z-50 bg-black/95 overflow-hidden touch-none select-none" role="dialog" aria-label="Picture" data-testid="zoomable"
      onWheel={e => zoomAt(v.k * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY)}
      onPointerDown={e => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const c = centre();
        start.current = { ...v, d: c.d, cx: c.x, cy: c.y, moved: false };
      }}
      onPointerMove={e => {
        if (!pts.current.has(e.pointerId) || !start.current) return;
        pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const s0 = start.current, c = centre();
        if (Math.hypot(c.x - s0.cx, c.y - s0.cy) > 6 || (c.d && s0.d && Math.abs(c.d - s0.d) > 6)) s0.moved = true;
        if (c.d && s0.d) {
          const k = clamp((s0.k * c.d) / s0.d);
          const ox = s0.cx - innerWidth / 2, oy = s0.cy - innerHeight / 2;
          setV({ k, x: ox - ((ox - s0.x) * k) / s0.k + (c.x - s0.cx), y: oy - ((oy - s0.y) * k) / s0.k + (c.y - s0.cy) });
        } else if (s0.k > 1) setV({ k: s0.k, x: s0.x + (c.x - s0.cx), y: s0.y + (c.y - s0.cy) });
      }}
      onPointerUp={e => {
        pts.current.delete(e.pointerId);
        const s0 = start.current;
        if (pts.current.size) { const c = centre(); start.current = { ...v, d: c.d, cx: c.x, cy: c.y, moved: true }; return; }
        start.current = null;
        // (not zoomed in: a swipe goes to the next or the one before)
        if (s0?.moved && step && s0.k === 1 && Math.abs(e.clientX - s0.cx) > 60 && Math.abs(e.clientX - s0.cx) > Math.abs(e.clientY - s0.cy)) { step.go(step.at + (e.clientX < s0.cx ? 1 : -1)); return; }
        if (s0?.moved) return;
        // (a double tap zooms in there, or back out; a tap with nothing zoomed closes)
        const now = Date.now();
        if (now - lastTap.current < 300) { lastTap.current = 0; zoomAt(v.k > 1 ? 1 : 3, e.clientX, e.clientY); return; }
        lastTap.current = now;
        setTimeout(() => { if (lastTap.current === now && v.k === 1) onClose(); }, 320);
      }}>
      <img src={src} alt="" draggable={false} className="absolute inset-0 m-auto max-w-full max-h-full object-contain will-change-transform" style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.k})`, transformOrigin: "center" }} />
      <button className="absolute top-3 right-3 rounded-full w-10 h-10 glass border border-white/[0.12] text-zinc-100 flex items-center justify-center" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={onClose} aria-label="Close"><X size={18} /></button>
      {step && step.of > 1 && (
        <>
          <button className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full w-11 h-11 glass border border-white/[0.12] text-zinc-100 flex items-center justify-center" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={() => step.go(step.at - 1)} aria-label="The one before"><ChevronLeft size={20} /></button>
          <button className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full w-11 h-11 glass border border-white/[0.12] text-zinc-100 flex items-center justify-center" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={() => step.go(step.at + 1)} aria-label="The next one" data-testid="zoomable-next"><ChevronRight size={20} /></button>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full glass border border-white/[0.12] text-[13px] text-zinc-100 whitespace-nowrap" data-testid="zoomable-count">{step.label} · {step.at + 1} of {step.of}</div>
        </>
      )}
    </div>
  );
}
