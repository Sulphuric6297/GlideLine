// In front of the app on a GlideLine Studio server: first-run setup, invite and reset links, signing in,
// and 2FA (set up, or a code) before anything else. Signed in, the app and the account dialogs.
import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { api, useAuth } from "./api";
import { Loading, LoadingScreen } from "../components/ui";
import { BackupCodes, CopyButton, Form, Input, Screen } from "./parts";
import { AccountDialog } from "./AccountDialog";
import { PeopleDialog } from "./PeopleDialog";
import { Home, mapRests } from "./Home";
import { getView, onLiveView } from "../state/view";
import { HistoryDialog, PreviewBar } from "./ChangesDialogs";
import { CommentLayer, CommentsPanel, loadComments, useCommentKeys, useComments } from "./Comments";
import { PresenceLayer, useSendHere } from "./Presence";
import { useServerCourse } from "./courses";
import { NearbyLayer } from "./Nearby";

const samePassword = (a: string, b: string) => { if (a !== b) throw new Error("The passwords don't match"); };

/** An invite or reset link opened: #invite=… or #reset=… */
const linkToken = () => {
  const m = /^#(invite|reset)=([A-Za-z0-9_-]{20,})$/.exec(location.hash);
  return m ? m[2] : null;
};
const clearLink = () => history.replaceState(null, "", location.pathname + location.search);

// (loaded when opened: publishing a site brings the map painter with it)
const ShareDialog = lazy(() => import("./ShareDialog").then(m => ({ default: m.ShareDialog })));

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, load, dialog, open, home } = useAuth();
  const [token, setToken] = useState(linkToken);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => { load().catch(() => setFailed(true)); }, [load]);
  // (the map behind the course list rests: it would draw for nothing; and stays resting after when
  // the step covers it)
  useEffect(() => { getView()?.setPaused(mapRests(home)); }, [home]);
  // (the map loads after the course list shows: it starts resting if the list is up)
  useEffect(() => onLiveView(v => v?.setPaused(mapRests(useAuth.getState().home))), []);
  const after = () => load();
  // (the editor, a few MB, loads once the course list is up: the list never waits on it)
  const listShown = useAuth(s => s.listShown);
  const [warm, setWarm] = useState(!home);
  useEffect(() => {
    if (warm) return;
    if (!home || listShown) { setWarm(true); return; }
    // (a list that's slow to come: the editor after a few seconds anyway)
    const id = window.setTimeout(() => setWarm(true), 4000);
    return () => window.clearTimeout(id);
  }, [home, warm, listShown]);

  if (failed) return <Screen title="Can't reach the server"><button className="text-sm text-orange-300" onClick={() => location.reload()}>Try again</button></Screen>;
  if (!session) return <LoadingScreen label="Loading…" />;

  // Backup codes, shown once, right after 2FA is set up
  if (codes) {
    return (
      <Screen title="Backup codes">
        <p className="text-sm text-zinc-300 mb-3">Each one signs you in once without your phone.</p>
        <BackupCodes codes={codes} />
        <button className="mt-4 w-full rounded-lg font-semibold px-3 py-2 text-sm touch:py-3 bg-orange-500 hover:bg-orange-400 text-zinc-950" onClick={() => { setCodes(null); void load(); }} data-testid="codes-saved">
          I've saved them
        </button>
      </Screen>
    );
  }

  if (token && session.stage !== "mfa-setup") return <LinkScreen token={token} onDone={() => { clearLink(); setToken(null); return load(); }} onBad={() => { clearLink(); setToken(null); }} />;
  if (session.stage === "mfa-setup") return <SetUp2fa onDone={c => setCodes(c)} />;
  if (session.stage === "mfa") return <CodeScreen onDone={() => load()} />;
  if (session.stage === "full" && session.user) {
    return (
      <>
        {warm && children}
        {home && <Home />}
        {dialog === "account" && <AccountDialog onClose={() => open(null)} />}
        {dialog === "people" && session.user.isAdmin && <PeopleDialog onClose={() => open(null)} />}
        {dialog === "share" && <Suspense fallback={<div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"><div className="glass-solid rounded-2xl px-5 py-4"><Loading label="Opening Share…" /></div></div>}><ShareDialog onClose={() => open(null)} /></Suspense>}
        {dialog === "history" && <HistoryDialog onClose={() => open(null)} />}
        {!home && <PreviewBar />}
        {!home && <CourseComments />}
        {!home && <NearbyLayer />}
      </>
    );
  }
  if (session.needsSetup) return <SetupScreen onDone={after} />;
  return <SignIn onDone={after} />;
}

function SignIn({ onDone }: { onDone: () => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  return (
    <Screen title="Sign in">
      <Form submit="Sign in" testid="sign-in" onSubmit={async () => { await api("POST", "login", { username, password }); await onDone(); }}>
        <Input label="Username" value={username} onChange={setUsername} auto="username" />
        <Input label="Password" value={password} onChange={setPassword} type="password" auto="current-password" />
      </Form>
    </Screen>
  );
}

function SetupScreen({ onDone }: { onDone: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  return (
    <Screen title="Create the admin account">
      <Form submit="Create" testid="setup" onSubmit={async () => { samePassword(password, again); await api("POST", "setup", { code, username, displayName, password }); await onDone(); }}>
        <Input label="Setup code (from the server's log)" value={code} onChange={setCode} mono />
        <Input label="Username" value={username} onChange={setUsername} auto="username" />
        <Input label="Your name" value={displayName} onChange={setDisplayName} auto="name" />
        <Input label="Password (12 characters or more)" value={password} onChange={setPassword} type="password" auto="new-password" />
        <Input label="Password again" value={again} onChange={setAgain} type="password" auto="new-password" />
      </Form>
    </Screen>
  );
}

function LinkScreen({ token, onDone, onBad }: { token: string; onDone: () => Promise<void>; onBad: () => void }) {
  const [info, setInfo] = useState<{ kind: "invite" | "reset"; username: string | null } | null | false>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  useEffect(() => { api<{ kind: "invite" | "reset"; username: string | null }>("GET", `invites/${token}`).then(setInfo, () => setInfo(false)); }, [token]);
  if (info === null) return <LoadingScreen label="Loading…" />;
  if (info === false) {
    return (
      <Screen title="Link expired">
        <p className="text-sm text-zinc-300 mb-4">This link has expired or was already used.</p>
        <button className="text-sm text-orange-300" onClick={onBad}>Sign in</button>
      </Screen>
    );
  }
  const accept = async () => {
    samePassword(password, again);
    await api("POST", `invites/${token}/accept`, info.kind === "invite" ? { username, displayName, password } : { password });
    await onDone();
  };
  return (
    <Screen title={info.kind === "invite" ? "Create your account" : `New password for ${info.username}`}>
      <Form submit={info.kind === "invite" ? "Create account" : "Set password"} testid="accept-link" onSubmit={accept}>
        {info.kind === "invite" && <Input label="Username" value={username} onChange={setUsername} auto="username" />}
        {info.kind === "invite" && <Input label="Your name" value={displayName} onChange={setDisplayName} auto="name" />}
        <Input label="Password (12 characters or more)" value={password} onChange={setPassword} type="password" auto="new-password" />
        <Input label="Password again" value={again} onChange={setAgain} type="password" auto="new-password" />
      </Form>
    </Screen>
  );
}

function SetUp2fa({ onDone }: { onDone: (codes: string[]) => void }) {
  const [enroll, setEnroll] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const signOut = useAuth(s => s.signOut);
  useEffect(() => { void api<{ secret: string; qr: string }>("POST", "mfa/enroll").then(setEnroll); }, []);
  return (
    <Screen title="Set up two-factor sign-in">
      {!enroll ? <Loading label="Loading…" className="h-64" /> : (
        <Form submit="Turn on" testid="mfa-setup" onSubmit={async () => onDone((await api<{ backupCodes: string[] }>("POST", "mfa/enroll/confirm", { code })).backupCodes)}>
          <p className="text-sm text-zinc-300">Scan with an authenticator app.</p>
          <img className="w-48 h-48 mx-auto rounded-lg bg-white p-2" alt="QR code for the authenticator app" src={`data:image/svg+xml;utf8,${encodeURIComponent(enroll.qr)}`} />
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate text-xs text-zinc-300 font-mono" data-testid="mfa-secret">{enroll.secret}</code>
            <CopyButton text={enroll.secret} label="Copy key" />
          </div>
          <Input label="Code from the app" value={code} onChange={setCode} auto="one-time-code" mono />
        </Form>
      )}
      <button className="mt-3 text-xs text-zinc-400 hover:text-zinc-200" onClick={() => void signOut()}>Cancel</button>
    </Screen>
  );
}

function CodeScreen({ onDone }: { onDone: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const { signOut, load } = useAuth();
  return (
    <Screen title="Two-factor sign-in">
      <Form submit="Continue" testid="mfa-code" onSubmit={async () => {
        try { await api("POST", "mfa/verify", { code }); } catch (e) { if ((e as { status?: number }).status === 401) await load(); throw e; }
        await onDone();
      }}>
        <Input label="Code from your app, or a backup code" value={code} onChange={setCode} auto="one-time-code" mono />
      </Form>
      <button className="mt-3 text-xs text-zinc-400 hover:text-zinc-200" onClick={() => void signOut()}>Cancel</button>
    </Screen>
  );
}

/** The open course's comments: loaded with it, pins over the map, the panel. */
function CourseComments() {
  const id = useServerCourse(s => s.id);
  const preview = useServerCourse(s => s.preview);
  useCommentKeys();
  useSendHere();
  useEffect(() => {
    useComments.setState({ threads: [], selected: null, placing: false, draftAt: null });
    // (no connection for a moment, a phone waking say: the next round tries again; nothing to say)
    void loadComments().catch(() => {});
    // (others' comments: looked for now and then)
    const t = window.setInterval(() => void loadComments().catch(() => {}), 30_000);
    return () => window.clearInterval(t);
  }, [id]);
  if (!id || preview) return null;
  return (
    <>
      <CommentLayer />
      <PresenceLayer />
      <CommentsPanel />
    </>
  );
}
