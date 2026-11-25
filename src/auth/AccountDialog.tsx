// Your account: name, password, two-factor sign-in (on or off, your choice unless an admin
// requires it), backup codes, and where you're signed in.
import { useEffect, useState } from "react";
import { Section } from "../components/ui";
import { api, useAuth } from "./api";
import { BackupCodes, CopyButton, Dialog, Form, Input, when } from "./parts";
import { saveNow } from "./courses";

interface SessionRow { id: string; current: boolean; createdAt: string; lastSeenAt: string; ip: string | null; userAgent: string | null }

/** "Chrome on Windows" from a user agent, near enough. */
const device = (ua: string | null) => {
  if (!ua) return "Unknown";
  const b = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${b} on ${os}` : b;
};

export function AccountDialog({ onClose }: { onClose: () => void }) {
  const { session, load } = useAuth();
  const user = session!.user!;
  const [name, setName] = useState(user.displayName);
  const [list, setList] = useState<{ sessions: SessionRow[]; backupCodesLeft: number } | null>(null);
  const [pw, setPw] = useState({ current: "", next: "", again: "", code: "" });
  const [pwDone, setPwDone] = useState(false);
  const [codesCode, setCodesCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  // Two-factor: being set up here (its QR code), or a code to turn it off
  const [enroll, setEnroll] = useState<{ secret: string; qr: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const mfa = user.totpEnabled;

  const refresh = () => api<{ sessions: SessionRow[]; backupCodesLeft: number }>("GET", "me/sessions").then(setList);
  useEffect(() => { void refresh(); }, []);

  return (
    <Dialog title="Account" onClose={onClose} testid="account-dialog">
      <div className="-mx-4">
        <Section title="Name">
          <Form compact submit="Save" onSubmit={async () => { await api("POST", "me", { displayName: name }); await load(); }}>
            <Input label={`Shown to others · signed in as ${user.username}`} value={name} onChange={setName} auto="name" />
          </Form>
        </Section>

        <Section title="Password">
          {pwDone ? <p className="text-sm text-emerald-300">Password changed. Signed out everywhere else.</p> : (
            <Form compact submit="Change password" testid="change-password" onSubmit={async () => {
              if (pw.next !== pw.again) throw new Error("The new passwords don't match");
              await api("POST", "me/password", { current: pw.current, next: pw.next, ...(mfa ? { code: pw.code } : {}) });
              setPwDone(true);
              void refresh();
            }}>
              <Input label="Current password" value={pw.current} onChange={v => setPw({ ...pw, current: v })} type="password" auto="current-password" />
              <Input label="New password" value={pw.next} onChange={v => setPw({ ...pw, next: v })} type="password" auto="new-password" />
              <Input label="New password again" value={pw.again} onChange={v => setPw({ ...pw, again: v })} type="password" auto="new-password" />
              {mfa && <Input label="Code from your app" value={pw.code} onChange={v => setPw({ ...pw, code: v })} auto="one-time-code" mono />}
            </Form>
          )}
        </Section>

        <Section title="Two-factor sign-in" testid="my-mfa">
          {mfa ? (
            user.mfaRequired
              ? <p className="text-sm text-zinc-300">On. Your admin requires it for your account, so it can't be turned off here.</p>
              : (
                <Form compact submit="Turn it off" testid="mfa-off" onSubmit={async () => { await api("POST", "me/mfa/off", { code: mfaCode }); setMfaCode(""); setCodes(null); await load(); }}>
                  <p className="text-sm text-zinc-300">On. Signing in asks for a code from your authenticator app after your password.</p>
                  <Input label="Code from your app (to turn it off)" value={mfaCode} onChange={setMfaCode} auto="one-time-code" mono />
                </Form>
              )
          ) : enroll ? (
            <Form compact submit="Turn it on" testid="mfa-on" onSubmit={async () => { setCodes((await api<{ backupCodes: string[] }>("POST", "mfa/enroll/confirm", { code: mfaCode })).backupCodes); setEnroll(null); setMfaCode(""); await load(); void refresh(); }}>
              <p className="text-sm text-zinc-300">Scan this with an authenticator app (Google Authenticator, 1Password, Authy and the like), then enter the code it shows.</p>
              <img className="w-44 h-44 mx-auto rounded-lg bg-white p-2" alt="QR code for the authenticator app" src={`data:image/svg+xml;utf8,${encodeURIComponent(enroll.qr)}`} />
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate text-xs text-zinc-300 font-mono" data-testid="mfa-secret">{enroll.secret}</code>
                <CopyButton text={enroll.secret} label="Copy key" />
              </div>
              <Input label="Code from the app" value={mfaCode} onChange={setMfaCode} auto="one-time-code" mono />
            </Form>
          ) : (
            <Form compact submit="Set it up" testid="mfa-start" onSubmit={async () => setEnroll(await api<{ secret: string; qr: string }>("POST", "mfa/enroll"))}>
              <p className="text-sm text-zinc-300">Off. Signing in asks for a code from an app on your phone too.</p>
            </Form>
          )}
        </Section>

        {mfa && <Section title="Backup codes">
          {codes ? <BackupCodes codes={codes} /> : (
            <Form compact submit="New backup codes" onSubmit={async () => { setCodes((await api<{ backupCodes: string[] }>("POST", "me/backup-codes", { code: codesCode })).backupCodes); void refresh(); }}>
              <p className="text-sm text-zinc-300">{list ? `${list.backupCodesLeft} left` : "…"}</p>
              <Input label="Code from your app" value={codesCode} onChange={setCodesCode} auto="one-time-code" mono />
            </Form>
          )}
        </Section>}
        {!mfa && codes && <Section title="Backup codes"><BackupCodes codes={codes} /></Section>}

        <Section title="Signed in">
          <ul className="space-y-1.5" data-testid="my-sessions">
            {list?.sessions.map(s => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-100">{device(s.userAgent)}{s.current && <span className="ml-2 text-[11px] text-emerald-300">This device</span>}</div>
                  <div className="text-[12px] text-zinc-500">{s.ip ?? ""} · {when(s.lastSeenAt)}</div>
                </div>
                {!s.current && <button className="text-xs text-red-300 hover:text-red-200" onClick={() => void api("DELETE", `me/sessions/${s.id}`).then(refresh, () => {})}>Sign out</button>}
              </li>
            ))}
          </ul>
          <button className="mt-4 text-sm text-red-300 hover:text-red-200" onClick={() => void saveNow().then(() => useAuth.getState().signOut())} data-testid="sign-out">Sign out</button>
        </Section>
      </div>
    </Dialog>
  );
}
