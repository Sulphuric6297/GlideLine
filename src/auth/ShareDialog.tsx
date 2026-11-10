// Who has the open course, and (for its owners) sharing it: viewers look, editors change, owners
// also share and delete.
import { useEffect, useState } from "react";
import { inputCls, Section, Segmented, Tabs } from "../components/ui";
import { changeDoc, useCourse } from "../state/course";
import { api, useAuth } from "./api";
import { managesLinks, saveNow, setEditorsLinks, useServerCourse, type Role } from "./courses";
import { CopyButton, Dialog, Form, when } from "./parts";
import { LINK_DEFAULT, LINK_PARTS, PART_LABELS, PARTS, VIEWER_DEFAULT, type Part, type Perms } from "./perms";
import { publishSite } from "./site";
import { Visitors } from "./Visitors";

interface Member { userId: string; username: string; displayName: string; role: Role; perms: Perms | null }
const ROLES: { value: Role; label: string }[] = [{ value: "viewer", label: "Viewer" }, { value: "editor", label: "Editor" }, { value: "owner", label: "Owner" }];

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const { id, role } = useServerCourse();
  const me = useAuth(s => s.session!.user!);
  const [members, setMembers] = useState<Member[]>([]);
  const [people, setPeople] = useState<{ username: string; displayName: string }[]>([]);
  const [username, setUsername] = useState("");
  const [newRole, setNewRole] = useState<Role>("editor");
  const [error, setError] = useState("");
  const [seeing, setSeeing] = useState<string | null>(null);
  const [tab, setTab] = useState<"people" | "public" | "visitors">(() => useAuth.getState().shareTab);
  const owner = role === "owner";

  const refresh = async () => { if (id) setMembers(await api<Member[]>("GET", `courses/${id}/members`)); };
  useEffect(() => { void refresh(); if (owner) void api<{ username: string; displayName: string }[]>("GET", "people").then(setPeople); }, [id]);

  const change = async (fn: () => Promise<unknown>) => {
    setError("");
    try { await fn(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
  };

  if (!id) {
    return <Dialog title="Share" onClose={onClose} testid="share-dialog"><p className="text-sm text-zinc-300">Add something to the course first: it's saved, then it can be shared.</p></Dialog>;
  }
  const others = people.filter(p => !members.some(m => m.username === p.username));
  return (
    <Dialog title="Share" onClose={onClose} testid="share-dialog">
      <div className="-mt-2 mb-2"><Tabs label="Share" value={tab} onChange={setTab} tabs={[{ value: "people", label: "People", testid: "share-tab-people" }, { value: "public", label: "Public link and site", testid: "share-tab-public" }, ...(role === "owner" || role === "editor" ? [{ value: "visitors" as const, label: "Visitors", testid: "share-tab-visitors" }] : [])]} /></div>
      <div className="-mx-4">
        {tab === "people" && owner && (
          <Section title="Add someone">
            <Form compact submit="Share" testid="share-add" onSubmit={async () => {
              await api("POST", `courses/${id}/members`, { username, role: newRole });
              setUsername("");
              await refresh();
            }}>
              <div className="flex gap-2">
                <label className="flex-1 min-w-0">
                  <span className="sr-only">Username</span>
                  <input className={inputCls} list="share-people" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} autoCapitalize="none" spellCheck={false} aria-label="Username" />
                </label>
                <select className="shrink-0 w-28 bg-white/[0.07] rounded-lg px-2 py-1.5 text-sm touch:py-2.5 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-400/80" value={newRole} onChange={e => setNewRole(e.target.value as Role)} aria-label="Role">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <datalist id="share-people">{others.map(p => <option key={p.username} value={p.username}>{p.displayName}</option>)}</datalist>
            </Form>
          </Section>
        )}
        {tab === "people" && <Section title="Has it">
          {seeing && (() => {
            const m = members.find(x => x.userId === seeing);
            if (!m) return null;
            const p = { ...VIEWER_DEFAULT, ...(m.perms ?? {}) };
            return (
              <div className="mb-3 rounded-lg bg-sky-950/40 p-3" data-testid="viewer-perms">
                <div className="text-[12px] text-sky-200 mb-2">What {m.displayName} sees</div>
                <Ticks parts={PARTS} value={p} onChange={next => void change(() => api("POST", `courses/${id}/members`, { username: m.username, role: m.role, perms: next }))} />
              </div>
            );
          })()}
          <ul className="divide-y divide-white/[0.08]" data-testid="members">
            {members.map(m => (
              <li key={m.userId} className="py-2 flex items-center gap-2 text-sm">
                <div className="flex-1 min-w-0">
                  <span className="text-zinc-100">{m.displayName}</span> <span className="text-zinc-500">{m.username}{m.userId === me.id ? " · you" : ""}</span>
                </div>
                {owner ? (
                  <select className="bg-white/[0.07] rounded-lg px-2 py-1 text-xs text-zinc-100" value={m.role} aria-label={`Role for ${m.username}`}
                    onChange={e => void change(() => api("POST", `courses/${id}/members`, { username: m.username, role: e.target.value }))}>
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                ) : <span className="text-xs text-zinc-400">{ROLES.find(r => r.value === m.role)!.label}</span>}
                {owner && m.role === "viewer" && (
                  <button className="text-xs text-sky-300 hover:text-sky-200" onClick={() => setSeeing(seeing === m.userId ? null : m.userId)} data-testid={`sees-${m.username}`}>What they see</button>
                )}
                {(owner || m.userId === me.id) && (
                  <button className="text-xs text-red-300 hover:text-red-200" onClick={() => void change(() => api("DELETE", `courses/${id}/members/${m.userId}`))}>
                    {m.userId === me.id ? "Leave" : "Remove"}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
        </Section>}
        {tab === "public" && <PublicSection id={id} />}
        {tab === "visitors" && <Visitors id={id} />}
      </div>
    </Dialog>
  );
}

/** Ticks for the parts that can be shown. */
function Ticks({ parts, value, onChange }: { parts: readonly Part[]; value: Perms; onChange: (p: Perms) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
      {parts.map(k => (
        <label key={k} className="flex items-center gap-2 text-sm text-zinc-200">
          <input type="checkbox" checked={!!value[k]} onChange={e => onChange({ ...value, [k]: e.target.checked })} data-testid={`part-${k}`} /> {PART_LABELS[k]}
        </label>
      ))}
    </div>
  );
}

/** How the map and 3D look to those who only look (a link's visitors, people who can view): the
 * course's own, the same for every link. The course's ground as Design shows it, unless set otherwise. */
function ViewerLook() {
  const pv = useCourse(s => s.doc.style.publicView) ?? {};
  const set = (p: Partial<typeof pv>) => changeDoc(d => ({ style: { ...d.style, publicView: { ...d.style.publicView, ...p } } }));
  return (
    <div className="rounded-lg bg-white/[0.05] p-2.5 space-y-2" data-testid="public-view">
      <div className="text-xs text-zinc-400">What viewers see</div>
      <Segmented label="Viewers' ground" value={pv.ground ?? "painted"} onChange={v => set({ ground: v as "painted" | "photo" })} options={[{ value: "painted", label: "Course ground" }, { value: "photo", label: "Satellite photo" }]} />
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <label className="flex items-center gap-2 text-sm text-zinc-200"><input type="checkbox" checked={!!pv.contours} onChange={e => set({ contours: e.target.checked })} /> Contour lines</label>
        {<label className="flex items-center gap-2 text-sm text-zinc-200"><input type="checkbox" checked={pv.shading ?? true} onChange={e => set({ shading: e.target.checked })} /> Hill shading</label>}
      </div>
    </div>
  );
}

interface Link { id: string; token: string; slug: string | null; label: string; perms: Perms; hasPassword: boolean; expiresAt: string | null; createdAt: string; revoked: boolean }
const linkUrl = (l: { token: string; slug?: string | null }) => `${location.origin}/${l.slug || l.token}`;
const partsOf = (p: Perms) => LINK_PARTS.filter(k => p[k]).map(k => PART_LABELS[k].replace(/ \(.*\)$/, "")).join(", ") || "Nothing";

/** Public links (each with what it shows, a password, an end), and the public site they show. */
function PublicSection({ id }: { id: string }) {
  const s = useServerCourse();
  // (owners, and editors when the owner allows it, make the links; everyone sees and copies them)
  const manage = managesLinks(s);
  const [links, setLinks] = useState<Link[]>([]);
  const [site, setSite] = useState<{ version: number; publishedAt: string } | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<{ label: string; slug: string; perms: Perms; password: string; expires: string }>({ label: "", slug: "", perms: LINK_DEFAULT, password: "", expires: "" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const version = useServerCourse(s => s.version);
  const refresh = async () => {
    setLinks(await api<Link[]>("GET", `courses/${id}/links`));
    setSite((await api<{ site: { version: number; publishedAt: string } | null }>("GET", `courses/${id}/site`)).site);
  };
  useEffect(() => { void refresh(); }, [id]);
  const act = async (fn: () => Promise<unknown>) => {
    setError("");
    try { await fn(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
  };
  // (the course saved first: the viewers' look below is part of it)
  const update = () => act(async () => { await saveNow(); await publishSite(id, setBusy); setBusy(""); });
  const save = () => act(async () => {
    const body = { label: form.label, slug: form.slug.trim() || null, perms: form.perms, password: form.password || (editing === "new" ? null : undefined), expiresAt: form.expires ? new Date(form.expires).toISOString() : null };
    if (editing === "new") await api("POST", `courses/${id}/links`, body);
    else await api("PATCH", `courses/${id}/links/${editing}`, body);
    setEditing(null);
    // (the site has what the links show: published again, so a new part is there)
    await publishSite(id, setBusy);
    setBusy("");
  });
  return (
    <>
      <Section title="Public site" testid="public-site-settings" help="public-site">
        <div className="flex items-center gap-3 text-sm">
          <span className="flex-1 text-zinc-300" data-testid="site-state">
            {site ? <>Shows version {site.version} · {when(site.publishedAt)}{site.version < version ? <span className="text-amber-300"> · the course changed since</span> : null}</> : "Not published yet"}
          </span>
          {manage && (
            <button className="rounded-lg px-3 py-1.5 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-zinc-950 disabled:opacity-50" disabled={!!busy} onClick={() => void update()} data-testid="update-site">
              {busy ? busy + "…" : site ? "Update site" : "Publish site"}
            </button>
          )}
        </div>
        {s.role !== "viewer" && <div className="mt-3"><ViewerLook /></div>}
        {s.role === "owner" && (
          <label className="mt-3 flex items-center gap-2 text-sm text-zinc-200">
            <input type="checkbox" checked={s.editorsLinks} onChange={e => void act(() => setEditorsLinks(e.target.checked))} data-testid="editors-links" />
            Editors can make public links and update the site
          </label>
        )}
      </Section>
      <Section title="Public links" testid="public-links" help="public-links">
        <ul className="space-y-2">
          {links.filter(l => manage || !l.revoked).map(l => (
            <li key={l.id} className={`rounded-lg bg-white/[0.07] p-2.5 text-sm ${l.revoked ? "opacity-60" : ""}`} data-testid="link">
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-zinc-100 font-medium">{l.label || "Public link"}{l.revoked ? " · off" : ""}{l.hasPassword ? " · password" : ""}{l.expiresAt ? ` · until ${new Date(l.expiresAt).toLocaleDateString()}` : ""}</span>
                {!l.revoked && <CopyButton text={linkUrl(l)} label="Copy link" />}
              </div>
              <div className="text-[12px] text-zinc-500 mt-1">{l.slug ? <span className="text-zinc-300">/{l.slug} · </span> : null}{partsOf(l.perms)}</div>
              {manage && <div className="flex gap-3 mt-1.5 text-xs">
                <button className="text-zinc-300 hover:text-zinc-50" onClick={() => { setEditing(l.id); setForm({ label: l.label, slug: l.slug ?? "", perms: l.perms, password: "", expires: l.expiresAt ? l.expiresAt.slice(0, 10) : "" }); }}>Change</button>
                <button className="text-zinc-300 hover:text-zinc-50" onClick={() => void act(() => api("PATCH", `courses/${id}/links/${l.id}`, { revoked: !l.revoked }))}>{l.revoked ? "Turn on" : "Turn off"}</button>
                <button className="text-zinc-300 hover:text-zinc-50" onClick={() => { if (confirm("Give it a new address? The old one stops working.")) void act(() => api("PATCH", `courses/${id}/links/${l.id}`, { newToken: true })); }}>New address</button>
                {l.hasPassword && <button className="text-zinc-300 hover:text-zinc-50" onClick={() => void act(() => api("PATCH", `courses/${id}/links/${l.id}`, { password: null }))}>No password</button>}
                <button className="text-red-300 hover:text-red-200" onClick={() => { if (confirm("Delete this link?")) void act(() => api("DELETE", `courses/${id}/links/${l.id}`)); }}>Delete</button>
              </div>}
            </li>
          ))}
        </ul>
        {editing ? (
          <div className="mt-3 rounded-lg bg-white/[0.07] p-3 space-y-2" data-testid="link-form">
            <input className={inputCls} placeholder="Label (where it's shared)" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} aria-label="Label" />
            <label className="block">
              <span className="flex items-center gap-2"><span className="text-xs text-zinc-400 shrink-0">{location.host}/</span>
                <input className={inputCls} placeholder="Its own name (optional), e.g. springfield-park" value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} aria-label="Link name" data-testid="link-slug" /></span>
              {form.slug && <span className="block text-[11px] text-zinc-500 mt-1">Easy to guess</span>}
            </label>
            <Ticks parts={LINK_PARTS} value={form.perms} onChange={perms => setForm({ ...form, perms })} />
            <div className="flex gap-2">
              <input className={inputCls} type="password" placeholder={editing === "new" ? "Password (optional)" : "New password (optional)"} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} aria-label="Password" />
              <input className={`${inputCls} w-40`} type="date" value={form.expires} onChange={e => setForm({ ...form, expires: e.target.value })} aria-label="Works until" />
            </div>
            <div className="flex gap-2 justify-end">
              <button className="px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/[0.09] rounded-lg" onClick={() => setEditing(null)}>Cancel</button>
              <button className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-orange-500 hover:bg-orange-400 text-zinc-950 disabled:opacity-50" disabled={!!busy} onClick={() => void save()} data-testid="save-link">{busy ? busy + "…" : editing === "new" ? "Make link" : "Save"}</button>
            </div>
          </div>
        ) : !manage ? (
          links.some(l => !l.revoked) ? null : <p className="text-sm text-zinc-400" data-testid="no-links">No public links yet. {s.role === "editor" ? "The owner can make one, or let editors make them." : "The owner makes them."}</p>
        ) : (
          <button className="mt-3 text-sm text-orange-300 hover:text-orange-200" onClick={() => { setEditing("new"); setForm({ label: "", slug: "", perms: LINK_DEFAULT, password: "", expires: "" }); }} data-testid="new-link">+ New public link</button>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
      </Section>
    </>
  );
}
