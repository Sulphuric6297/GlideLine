// The public demo's first page, as a GlideLine Studio server's Courses page is: the courses kept in this
// browser to open with one click (the example course first, for anyone new), Open a course file
// and New course, and beside them a walk around the example, Getting started, the help topics that
// matter most and a tip. The editor loads behind it. The logo (or Courses in a phone's menu) comes
// back here, and Esc or ← goes back to the course. (On a phone the walk comes first.)
//
// The back door (#example-admin on the address): the open course made the example everyone gets,
// cleaned of where it is, published to the demo's code with a GitHub key typed in then and there
// (never kept), or saved as files.
import { placeBefore } from "../state/tabPlace";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { ArrowLeft, BookOpen, Compass, Download, FolderOpen, Loader2, Plus, RotateCcw, Search, Trash2, Upload } from "lucide-react";
import { TOPICS } from "../lib/guide";
import { EXAMPLE_ID, EXAMPLE_PATHS, EXAMPLE_THUMB, asExample, startsBlank } from "../lib/example";
import { fmtDist } from "../lib/units";
import { SERVER } from "../auth/api";
import { MiniMap, PageToasts, TipCard, ago, learnFor, mapRests, pickTip } from "../auth/Home";
import { Logo } from "../auth/parts";
import { getDoc, useCourse } from "../state/course";
import { cardThumb, deleteRecent, download, exampleChanged, isEmpty, newCourse, openCourseFile, openExample, openRecent, recentCourses, restartExample, summaryOf, type KeptMeta } from "../state/files";
import { getView, onLiveView } from "../state/view";
import { HelpGuide } from "./help/HelpGuide";
import { HelpLink } from "./ui";
import { StartCard, openGettingStarted, useStart } from "./GettingStarted";
import { startTour, walked } from "./Tour";
import { useTouch } from "./useLayout";
import { Woods } from "./Woods";
import { DEMO_ADDS, REPO } from "./DemoNote";

// (a tab refreshed in the course: back in it, not on the home page)
export const useDemoHome = create<{ open: boolean }>(() => ({ open: !SERVER && !startsBlank() && !placeBefore }));
/** Back to the demo's Courses page. */
export const goDemoHome = () => useDemoHome.setState({ open: true });
const close = () => useDemoHome.setState({ open: false });

/** A course kept here: its name and numbers on glass over its picture (the example: its photo;
 * the others: their holes' lines over their photo, or the lines alone, as on a server's Courses
 * page). */
function Card({ name, sub, note, picture, badge, onOpen, onRemove, onRestart, busy, testid }: { name: string; sub: string; note?: string; picture?: ReactNode; badge?: string; onOpen: () => void; onRemove?: () => void; onRestart?: () => void; busy?: boolean; testid: string }) {
  return (
    <li className="group relative rounded-[22px] overflow-hidden ring-1 ring-white/10 hover:ring-white/25 shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition" data-testid={testid}>
      <button className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded-[22px]" onClick={onOpen} aria-busy={busy || undefined}>
        <div className="aspect-[4/3] overflow-hidden bg-gradient-to-br from-emerald-950 via-emerald-900/70 to-zinc-900 flex items-center justify-center">
          {picture ? <div className="w-full h-full transition-transform duration-500 group-hover:scale-[1.02]">{picture}</div> : <Logo size={44} />}
        </div>
        {busy && (
          <div className="absolute inset-0 bg-black/40 flex items-start justify-center pt-[18%]">
            <span className="glass rounded-full px-3.5 py-1.5 text-sm font-semibold text-zinc-50 inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin text-orange-300" /> Opening…</span>
          </div>
        )}
        <div className="glass absolute left-2.5 right-2.5 bottom-2.5 rounded-[16px] px-3.5 py-2.5">
          <div className="flex items-start gap-2">
            <h3 className="flex-1 min-w-0 font-semibold text-zinc-50 truncate">{name}</h3>
            {badge && <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/15 text-sky-200">{badge}</span>}
          </div>
          <p className="text-[13px] text-zinc-300 mt-0.5">{sub}</p>
          {note && <p className="text-[11.5px] text-zinc-400 mt-1">{note}</p>}
        </div>
      </button>
      <div className="absolute top-2.5 right-2.5 flex gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 touch:opacity-100 transition-opacity">
        {onRestart && <button className="glass p-1.5 touch:p-[15px] rounded-full text-zinc-200 hover:text-orange-200" aria-label={`Start ${name} over`} title="Start it over, as it first was" onClick={onRestart} data-testid="example-restart"><RotateCcw size={15} /></button>}
        {onRemove && <button className="glass p-1.5 touch:p-[15px] rounded-full text-zinc-200 hover:text-red-300" aria-label={`Delete ${name}`} onClick={onRemove}><Trash2 size={15} /></button>}
      </div>
    </li>
  );
}

const REPO_NAME = "Sulphuric6297/GlideLine";
const API = `https://api.github.com/repos/${REPO_NAME}`;

/** The open course's photo, small, for the example's card. */
const thumbOf = async (doc: ReturnType<typeof getDoc>): Promise<Blob | null> => {
  if (!doc.background) return null;
  const img = new Image();
  img.src = doc.background;
  await img.decode();
  const k = Math.min(1, 720 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
};
const base64 = (b: Blob) => new Promise<string>(r => { const f = new FileReader(); f.onload = () => r(String(f.result).split(",", 2)[1]); f.readAsDataURL(b); });

/** The open course, as the example everyone gets: both files in one commit on main (its tests then
 * run and the demo is published as for any change). */
const publish = async (token: string, say: (s: string) => void) => {
  const doc = asExample(getDoc());
  const gh = async (path: string, init?: RequestInit) => {
    const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
    if (!r.ok) throw new Error(`GitHub said ${r.status}: ${((await r.json().catch(() => ({}))) as { message?: string }).message ?? r.statusText}`);
    return r.json();
  };
  say("Sending the course…");
  const course = await gh("/git/blobs", { method: "POST", body: JSON.stringify({ content: await base64(new Blob([JSON.stringify(doc)])), encoding: "base64" }) });
  const pic = await thumbOf(doc);
  const thumb = pic ? await gh("/git/blobs", { method: "POST", body: JSON.stringify({ content: await base64(pic), encoding: "base64" }) }) : null;
  say("Making the change…");
  const ref = await gh("/git/ref/heads/main");
  const head = await gh(`/git/commits/${ref.object.sha}`);
  const tree = await gh("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: head.tree.sha, tree: [{ path: EXAMPLE_PATHS.course, mode: "100644", type: "blob", sha: course.sha }, ...(thumb ? [{ path: EXAMPLE_PATHS.thumb, mode: "100644", type: "blob", sha: thumb.sha }] : [])] }) });
  const commit = await gh("/git/commits", { method: "POST", body: JSON.stringify({ message: `The demo's example course: ${doc.name}`, tree: tree.sha, parents: [ref.object.sha] }) });
  await gh("/git/refs/heads/main", { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) });
  say(`Published. The demo's tests run now, and it goes live when they pass (about 20 minutes).`);
};

/** The back door: the open course as the example. */
function ExampleAdmin() {
  const name = useCourse(s => s.doc.name);
  const [token, setToken] = useState("");
  const [state, setState] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await publish(token.trim(), setState); setToken(""); } catch (e) { setState(e instanceof Error ? e.message : "That didn't work."); } finally { setBusy(false); }
  };
  const save = async () => {
    const doc = asExample(getDoc());
    download(new Blob([JSON.stringify(doc)], { type: "application/json" }), "course.json");
    const pic = await thumbOf(doc);
    if (pic) download(pic, "thumb.jpg");
  };
  return (
    <div className="glass rounded-[22px] p-4 ring-1 ring-orange-400/40" data-testid="example-admin">
      <div className="flex items-center gap-2 text-[14px] font-bold text-zinc-50"><Upload size={16} className="text-orange-300" />The example course</div>
      <p className="text-[13px] text-zinc-400 mt-1.5 leading-snug">Makes the course open in the editor, <span className="text-zinc-200">{name || "Untitled course"}</span>, the example everyone gets. Where it is on the earth is taken out first.</p>
      <p className="text-[12.5px] text-zinc-400 mt-2 leading-snug">Publishing needs a GitHub key that can change this project's files. It's used once and not kept anywhere.</p>
      <input type="password" autoComplete="off" spellCheck={false} className="mt-2 w-full rounded-[12px] bg-white/[0.08] px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-400/70" placeholder="GitHub key" value={token} onChange={e => setToken(e.target.value)} aria-label="GitHub key" />
      <div className="flex gap-2 mt-2">
        <button className="flex-1 rounded-full px-3 py-2 text-[13px] font-semibold bg-orange-500 hover:bg-orange-400 text-zinc-950 disabled:opacity-40 inline-flex items-center justify-center gap-1.5" disabled={!token.trim() || busy} onClick={() => void go()} data-testid="example-publish">{busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Publish it</button>
        <button className="rounded-full px-3 py-2 text-[13px] font-semibold bg-white/[0.1] hover:bg-white/[0.16] text-zinc-50 inline-flex items-center gap-1.5" onClick={() => void save()} data-testid="example-save"><Download size={15} /> Save the files</button>
      </div>
      {state && <p className="text-[12.5px] text-zinc-300 mt-2" role="status">{state}</p>}
    </div>
  );
}

/** A card's numbers: holes, par and length (what's known of them). */
const factsOf = (holes: number, summary?: KeptMeta["summary"]) =>
  [`${holes} hole${holes === 1 ? "" : "s"}`, summary?.par ? `Par ${summary.par}` : null, summary?.length && summary.units ? fmtDist(summary.length, summary.units) : null].filter(Boolean).join(" · ");

/** Opening the example (or the walk around it) didn't work: most likely the connection. */
const EXAMPLE_FAILED = "Couldn't load the example course. Check your connection and try again.";

export function DemoHome() {
  const open = useDemoHome(s => s.open);
  const doc = useCourse(s => s.doc);
  const [plans, setPlans] = useState<KeptMeta[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  // (something that didn't open: said here, where it was asked for)
  const [notice, setNotice] = useState("");
  const [q, setQ] = useState("");
  const [help, setHelp] = useState<false | { topic?: string }>(false);
  const touch = useTouch();
  const start = useStart();
  const [tip] = useState(() => pickTip(touch));
  const admin = typeof location !== "undefined" && location.hash === "#example-admin";
  const refresh = () => void recentCourses().then(setPlans);
  useEffect(() => { if (open) { setNotice(""); refresh(); } }, [open]);
  // (the map behind rests while this is up, and stays resting after when the step covers it)
  useEffect(() => { getView()?.setPaused(mapRests(open)); }, [open]);
  useEffect(() => onLiveView(v => v?.setPaused(mapRests(useDemoHome.getState().open))), []);
  // (the editor's own keys wait; Esc goes back to the course, as the back button does)
  useEffect(() => {
    if (!open || help) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches?.("input,textarea")) return;
      e.stopImmediatePropagation();
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, help]);
  // (the open course's photo, small, for its card; the others keep theirs from when they were put away)
  const [nowThumb, setNowThumb] = useState<string | undefined>();
  useEffect(() => {
    if (!open) return;
    let live = true;
    void cardThumb(doc).then(t => { if (live) setNowThumb(t); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc.background]);
  const fileRef = useRef<HTMLInputElement>(null);

  /** Opens something, then this page closes (not when it didn't open: `run` gives false, or
   * fails and `failed` says so here). */
  const busy = async (id: string, run: () => Promise<unknown>, failed = "That didn't open. Try again.") => {
    if (opening) return;
    setOpening(id);
    setNotice("");
    try { if ((await run()) !== false) close(); } catch (err) { console.warn(err); setNotice(failed); } finally { setOpening(null); }
  };
  const here = (id: string) => doc.id === id;
  const kept = plans ?? [];
  const exampleKept: KeptMeta | undefined = here(EXAMPLE_ID) ? { id: EXAMPLE_ID, name: doc.name, holes: doc.holes.length, updatedAt: Date.now(), summary: summaryOf(doc) } : kept.find(p => p.id === EXAMPLE_ID);
  // (changed since it was fresh: someone's own copy, to start over)
  const changed = !!exampleKept && exampleChanged();
  const exampleName = exampleKept?.name || "Thunder Hollow";
  const t = q.trim().toLowerCase();
  const exampleShown = !t || `${exampleName} example`.toLowerCase().includes(t);
  // (the open course, then the rest kept here, newest first; the example on its own card)
  const others = useMemo(() => {
    const list: (KeptMeta & { now?: boolean })[] = [];
    if (!here(EXAMPLE_ID) && !isEmpty(doc)) list.push({ id: doc.id ?? "open", name: doc.name || "Untitled course", holes: doc.holes.length, updatedAt: Date.now(), summary: summaryOf(doc), thumb: nowThumb, canvas: doc.canvas, now: true });
    for (const p of kept) if (p.id !== EXAMPLE_ID && p.id !== doc.id) list.push(p);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, plans, nowThumb]);
  if (!open) return null;
  const shown = t ? others.filter(c => c.name.toLowerCase().includes(t)) : others;
  // (Search once there are enough to look through: the example and three more)
  const searchable = others.length + 1 >= 4 || !!t;
  // (one main button: the walk until it's been taken, then New course)
  const walk = walked();
  const learn = learnFor(touch).map(id => TOPICS.find(x => x.id === id)).filter(Boolean) as typeof TOPICS;
  /** Getting started in a course of your own: the example open, a new one first. */
  const openStart = () => void busy("start", async () => { if (getDoc().id === EXAMPLE_ID) await newCourse(); openGettingStarted(); });
  const tour = (
    <div className="glass rounded-[22px] p-4" data-testid="home-tour">
      <div className="flex items-center gap-2 text-[14px] font-bold text-zinc-50"><Compass size={17} className="text-orange-300" />A walk around the example</div>
      <button className={`mt-3 w-full rounded-full px-3 py-2 touch:py-3 text-[13px] font-semibold ${walk ? "bg-white/[0.1] hover:bg-white/[0.16] text-zinc-50" : "bg-orange-500 hover:bg-orange-400 text-zinc-950"}`} onClick={() => void busy("tour", startTour, EXAMPLE_FAILED)} disabled={!!opening} data-testid="home-tour-start">{opening === "tour" ? "Opening…" : "Show me around"}</button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] bg-zinc-950 overflow-y-auto isolate" data-testid="demo-home">
      <Woods />
      <header className="glass sticky top-2.5 z-10 mx-2.5 rounded-[22px]">
        <div className="max-w-6xl mx-auto h-[52px] px-3 flex items-center gap-3">
          <Logo size={30} />
          <span className="font-bold text-zinc-50 text-[17px]">GlideLine Studio</span>
          <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold bg-sky-500/15 text-sky-200 border border-sky-500/30">Demo</span>
          <div className="flex-1" />
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm text-zinc-200 hover:bg-white/[0.08] max-w-[260px]" onClick={close} data-testid="demo-home-back">
            <ArrowLeft size={15} /><span className="truncate">{isEmpty(doc) ? "To the editor" : doc.name}</span>
          </button>
        </div>
      </header>

      <main className="relative max-w-6xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-6 lg:pr-[324px]">
          <div className="flex-1">
            <h1 className="text-3xl sm:text-[34px] font-bold tracking-[-0.025em] text-zinc-50">Courses</h1>
            <p className="text-zinc-400 text-sm mt-1 flex items-center gap-1.5">Kept in this browser <HelpLink topic="save-local" label="Kept in this browser" /></p>
          </div>
          {searchable && (
            <label className="relative sm:w-56">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input className="glass w-full rounded-full pl-9 pr-3 py-2 touch:py-3 text-sm touch:text-base text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-400/80" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} aria-label="Search courses" />
            </label>
          )}
          <div className="flex gap-2">
            <button className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 touch:py-3 text-sm font-semibold glass text-zinc-100 hover:bg-white/[0.1] disabled:opacity-60" onClick={() => fileRef.current?.click()} disabled={!!opening} data-testid="demo-open-file">
              {opening === "file" ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />} Open a course file
            </button>
            <button className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 touch:py-3 text-sm font-semibold ${walk ? "bg-orange-500 hover:bg-orange-400 text-zinc-950 shadow" : "glass text-zinc-100 hover:bg-white/[0.1]"}`} onClick={() => void busy("new", newCourse)} disabled={!!opening} data-testid="demo-new-course">
              {opening === "new" ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} New course
            </button>
          </div>
          {/* (not a course file: said in a toast, and this page stays) */}
          <input ref={fileRef} type="file" accept=".json,.dgcourse.json,application/json" className="hidden" aria-label="Open a course file" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void busy("file", () => openCourseFile(f)); }} />
        </div>

        {/* (a wide screen: the courses, and beside them the walk, then the rest; a narrow one: the
            walk first, so it isn't under every card) */}
        <div className="grid gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[auto_1fr] items-start">
          <div className="lg:col-start-2 lg:row-start-1">{tour}</div>
          <div className="min-w-0 lg:col-start-1 lg:row-start-1 lg:row-span-2">
            {notice && <p className="glass rounded-[18px] px-4 py-3 mb-4 text-sm text-red-200" role="alert" data-testid="home-notice">{notice}</p>}
            <ul className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
              {exampleShown && (
                <Card
                  testid="example-card"
                  name={exampleName}
                  badge="Example"
                  sub={exampleKept ? factsOf(exampleKept.holes, exampleKept.summary) : "An 18-hole course to look around"}
                  note={here(EXAMPLE_ID) ? (changed ? "Your copy, open now" : "Open now") : changed ? `Your copy, changed ${ago(exampleKept!.updatedAt)}` : undefined}
                  picture={<img src={EXAMPLE_THUMB} alt="" className="w-full h-full object-cover" />}
                  busy={opening === EXAMPLE_ID}
                  onOpen={() => void busy(EXAMPLE_ID, openExample, EXAMPLE_FAILED)}
                  onRestart={changed ? () => void busy(EXAMPLE_ID, restartExample, EXAMPLE_FAILED) : undefined}
                />
              )}
              {shown.map(c => (
                <Card
                  key={c.id}
                  testid="course-card"
                  name={c.name}
                  sub={factsOf(c.holes, c.summary)}
                  note={c.now ? "Open now" : `Updated ${ago(c.updatedAt)}`}
                  picture={c.thumb && c.canvas ? <MiniMap c={{ holes: c.holes, summary: c.summary ?? {} }} frame={c.canvas} photo={c.thumb} /> : c.summary?.lines?.length ? <MiniMap c={{ holes: c.holes, summary: c.summary }} /> : undefined}
                  busy={opening === c.id}
                  onOpen={() => void busy(c.id, async () => { if (!c.now) await openRecent(c.id); })}
                  onRemove={c.now ? undefined : () => void deleteRecent(c.id, refresh).then(refresh)}
                />
              ))}
            </ul>
            {!exampleShown && !shown.length && <p className="text-sm text-zinc-500 mt-1" data-testid="no-match">No courses match.</p>}
          </div>

          <aside className="flex flex-col gap-4 lg:col-start-2 lg:row-start-2" data-testid="home-side">
            {admin && <ExampleAdmin />}
            <StartCard onOpen={openStart} disabled={!!opening} />
            <div className="glass rounded-[22px] p-4" data-testid="home-learn">
              <div className="flex items-center gap-2 text-[14px] font-bold text-zinc-50"><BookOpen size={16} className="text-orange-300" />Learn the app</div>
              <ul className="mt-2 -mx-1.5">
                {learn.map(t => <li key={t.id}><button className="w-full text-left rounded-[12px] px-1.5 py-1.5 hover:bg-white/[0.07] text-[13px] text-zinc-200" onClick={() => setHelp({ topic: t.id })}>{t.title}</button></li>)}
              </ul>
              <button className="mt-1 text-[12.5px] font-semibold text-orange-300 hover:text-orange-200" onClick={() => setHelp({})}>The whole help guide ›</button>
              {!start.onHome && <button className="block mt-1.5 text-[12.5px] font-semibold text-zinc-400 hover:text-zinc-200" onClick={() => start.set({ onHome: true })}>Show Getting started</button>}
            </div>
            <TipCard tip={tip} onMore={topic => setHelp({ topic })} />
            <div className="glass rounded-[22px] p-4" data-testid="home-about">
              <div className="text-[13px] font-bold text-zinc-50">This is the public demo</div>
              <p className="text-[12.5px] text-zinc-400 mt-1.5 leading-snug">Hosting GlideLine Studio yourself adds:</p>
              <ul className="mt-1 space-y-0.5 text-[12.5px] text-zinc-300 list-disc pl-4">{DEMO_ADDS.map(a => <li key={a}>{a}</li>)}</ul>
              <a className="mt-2 inline-block text-[12.5px] font-semibold text-orange-300 hover:text-orange-200" href={REPO} target="_blank" rel="noreferrer">How to host it ›</a>
            </div>
          </aside>
        </div>
      </main>
      {help && <HelpGuide onClose={() => setHelp(false)} topic={help.topic} touch={touch} onShow={close} />}
      <PageToasts />
    </div>
  );
}
