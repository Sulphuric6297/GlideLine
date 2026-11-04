// Talking to the GlideLine Studio server, when the app is built for one (VITE_SERVER=1). Without it the
// app is the browser-only demo and none of this runs.
import { placeBefore } from "../state/tabPlace";
import { create } from "zustand";

export const SERVER = import.meta.env.VITE_SERVER === "1";

export class ApiFail extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`./api/${path}`, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? {} : { "content-type": "application/json", "x-hyzerlab": "1" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiFail(res.status, data.error ?? "Something went wrong");
  return data as T;
}

export type Stage = "mfa" | "mfa-setup" | "full";
export interface User { id: string; username: string; displayName: string; isAdmin: boolean; totpEnabled: boolean; mfaRequired?: boolean }
export interface Session { needsSetup: boolean; stage: Stage | null; user: User | null }

type Dialog = null | "account" | "people" | "share" | "history";

export const useAuth = create<{
  session: Session | null;
  dialog: Dialog;
  /** The course list (the first page once signed in), over the app. */
  home: boolean;
  showHome: (on: boolean) => void;
  /** Goes up when the course list should be read again (a course's picture just changed). */
  listVersion: number;
  bump: () => void;
  load: () => Promise<void>;
  signOut: () => Promise<void>;
  open: (d: Dialog) => void;
  /** The share dialog's tab to open on (people, or the public link). */
  shareTab: "people" | "public" | "visitors";
  /** The course list has been drawn (the editor may load behind it now). */
  listShown: boolean;
  share: (tab: "people" | "public" | "visitors") => void;
}>((set, get) => ({
  session: null,
  dialog: null,
  // (a tab refreshed in a course: back in it, not on the list)
  home: !placeBefore,
  showHome: home => set({ home, dialog: null }),
  listVersion: 0,
  bump: () => set({ listVersion: get().listVersion + 1 }),
  load: async () => set({ session: await api<Session>("GET", "session") }),
  signOut: async () => {
    await api("POST", "logout").catch(() => {});
    set({ dialog: null, home: true });
    await get().load();
  },
  open: dialog => set({ dialog, shareTab: "people" }),
  shareTab: "people",
  listShown: false,
  share: shareTab => set({ dialog: "share", shareTab })
}));

/** A link for an invite or a reset: the token after #, so it never reaches a server's logs. */
export const linkFor = (kind: "invite" | "reset", token: string) => `${location.origin}${location.pathname}#${kind}=${token}`;
