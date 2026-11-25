// The bell: replies in your threads, mentions and assignments. One goes to its comment.
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { api, useAuth } from "./api";
import { openServerCourse, useServerCourse } from "./courses";
import { loadComments, openComments } from "./Comments";
import { when } from "./parts";

interface Notice { id: number; kind: "reply" | "mention" | "assigned" | "declined"; at: string; read: boolean; courseId: string; course: string | null; by: string | null; body: string; threadId: string }

const WHAT = { reply: "replied", mention: "mentioned you", assigned: "assigned you", declined: "asked for changes" } as const;

export function NoticeBell() {
  const [list, setList] = useState<{ unread: number; items: Notice[] }>({ unread: 0, items: [] });
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const refresh = () => api<{ unread: number; items: Notice[] }>("GET", "notifications").then(setList, () => {});
  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (!menu) return;
    void refresh();
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);
  const go = async (n: Notice) => {
    setMenu(false);
    void api("POST", "notifications/read", { ids: [n.id] }).then(refresh, () => {});
    if (useServerCourse.getState().id !== n.courseId && !(await openServerCourse(n.courseId))) return;
    useAuth.getState().showHome(false);
    if (!n.threadId) return;
    // (the list as it was if it can't be fetched now: the thread opens all the same)
    await loadComments().catch(() => {});
    openComments(n.threadId);
  };
  return (
    <div className="relative" ref={ref}>
      <button className="relative p-2 rounded-lg text-zinc-400 hover:text-zinc-50 hover:bg-white/[0.09] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" aria-label={list.unread ? `${list.unread} new notices` : "Notices"} onClick={() => setMenu(m => !m)} data-testid="notice-bell">
        <Bell size={18} />
        {list.unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-zinc-950 text-[11px] font-bold flex items-center justify-center" data-testid="notice-count">{list.unread}</span>}
      </button>
      {menu && (
        <div className="absolute right-0 top-full mt-1 w-80 max-h-[70vh] overflow-y-auto glass-solid rounded-xl shadow-xl shadow-black/40 ring-1 ring-white/10 py-1 z-50" role="menu" data-testid="notices">
          <div className="flex items-center px-3 py-1.5">
            <span className="text-[12px] font-bold uppercase tracking-wider text-zinc-500 flex-1">Notices</span>
            {list.unread > 0 && <button className="text-xs text-orange-300" onClick={() => void api("POST", "notifications/read", {}).then(refresh, () => {})}>Mark all read</button>}
          </div>
          {list.items.length === 0 && <p className="px-3 py-2 text-sm text-zinc-500">Nothing yet.</p>}
          {list.items.map(n => (
            <button key={n.id} role="menuitem" className={`w-full text-left px-3 py-2 hover:bg-white/[0.09] ${n.read ? "" : "bg-orange-500/5"}`} onClick={() => void go(n)} data-testid="notice">
              <div className="text-sm text-zinc-100">{!n.read && <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400 mr-1.5 align-middle" />}<b>{n.by ?? "Someone"}</b> {WHAT[n.kind]} · {n.course}</div>
              <div className="text-[12px] text-zinc-400 truncate">{n.body}</div>
              <div className="text-[11px] text-zinc-600">{when(n.at)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
