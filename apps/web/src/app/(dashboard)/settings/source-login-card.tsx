"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, KeyRound, Loader2, PlugZap, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AutoRefresh } from "@/components/auto-refresh";
import { removeSourceCredentialsAction, saveSourceCredentialsAction, testSourceConnectionAction, type SourceActionState } from "./source-actions";

export type SourceLoginInfo = {
  id: string;
  name: string;
  baseUrl: string;
  authMode: "MANUAL_SESSION" | "CREDENTIALS";
  username: string | null;
  hasPassword: boolean;
  sessionSavedAt: string | null;
  autoLoginAt: string | null;
  autoLoginError: string | null;
  loginTestRequestedAt: string | null;
  approvedFields: string;
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : null);

/** Settings → Source connection: MahaHRD sign-in with a saved (encrypted) password, a connection test and status. */
export function SourceLoginCard({ s, canManage, workerOnline }: { s: SourceLoginInfo; canManage: boolean; workerOnline: boolean }) {
  const [saveState, save, saving] = useActionState(saveSourceCredentialsAction, undefined);
  const [other, setOther] = useState<SourceActionState>();
  const [busy, start] = useTransition();
  const automatic = s.authMode === "CREDENTIALS" && s.hasPassword;
  const testing = !!s.loginTestRequestedAt;
  const notice = other ?? saveState;

  return (
    <div className="space-y-5">
      <AutoRefresh active={testing} ms={3000} />
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Name</dt><dd className="font-medium">{s.name}</dd></div>
        <div><dt className="text-muted-foreground">URL</dt><dd className="font-mono text-xs">{s.baseUrl}</dd></div>
        <div>
          <dt className="text-muted-foreground">Sign-in</dt>
          <dd className="flex flex-wrap items-center gap-2 font-medium">
            {automatic ? (
              <Badge className="border-0 bg-success/10 text-success">Automatic</Badge>
            ) : (
              <Badge className="border-0 bg-muted text-muted-foreground">Manual (no password saved)</Badge>
            )}
            {s.sessionSavedAt && <span className="text-xs font-normal text-muted-foreground">session saved {when(s.sessionSavedAt)}</span>}
          </dd>
        </div>
        <div><dt className="text-muted-foreground">Approved fields</dt><dd className="font-medium">{s.approvedFields}</dd></div>
      </dl>

      {automatic && (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm" role="status">
          {testing ? (
            <p className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Testing the sign-in to {s.name}…{!workerOnline && " (waiting for the sync worker to come online)"}</p>
          ) : s.autoLoginError ? (
            <p className="flex items-start gap-2 text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /> <span>Last sign-in failed: {s.autoLoginError}</span></p>
          ) : s.autoLoginAt ? (
            <p className="flex items-center gap-2 text-success"><CheckCircle2 className="size-4" /> Signed in automatically {when(s.autoLoginAt)} as <b>{s.username}</b>.</p>
          ) : (
            <p className="text-muted-foreground">Not tested yet.</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Syncs sign in by themselves when needed (also when a session expires mid-sync). If MahaHRD refuses the password, the sync pauses with a message here.
          </p>
        </div>
      )}

      {notice?.error && (
        <Alert variant="destructive"><AlertCircle /><AlertDescription>{notice.error}</AlertDescription></Alert>
      )}
      {notice?.ok && notice.message && (
        <Alert className="border-success/30 bg-success/5 text-success"><CheckCircle2 /><AlertDescription className="text-success">{notice.message}</AlertDescription></Alert>
      )}

      {canManage ? (
        <form action={(fd) => { setOther(undefined); save(fd); }} className="space-y-3 rounded-xl border p-4" autoComplete="off">
          <p className="text-sm font-medium">MahaHRD admin account used by the sync</p>
          <input type="hidden" name="sourceId" value={s.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`src-user-${s.id}`}>MahaHRD username</Label>
              <Input id={`src-user-${s.id}`} name="username" defaultValue={s.username ?? ""} required autoCapitalize="none" spellCheck={false} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`src-pass-${s.id}`}>MahaHRD password</Label>
              <Input id={`src-pass-${s.id}`} name="password" type="password" autoComplete="new-password" placeholder={s.hasPassword ? "•••••••• saved — leave empty to keep" : ""} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            The password is stored encrypted on the server, is never shown again and is used only by the sync worker to sign in to {s.name}. Use an account the data owner has authorised for this.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving || busy}>
              {saving ? <Loader2 className="animate-spin" /> : <KeyRound />} {s.hasPassword ? "Save changes" : "Save and test"}
            </Button>
            {automatic && (
              <Button type="button" variant="outline" disabled={saving || busy || testing} onClick={() => start(async () => setOther(await testSourceConnectionAction(s.id)))}>
                <PlugZap /> Test connection
              </Button>
            )}
            {s.hasPassword && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={saving || busy}
                onClick={() => {
                  if (confirm(`Remove the saved ${s.name} password? Syncs will then need a manual sign-in.`)) start(async () => setOther(await removeSourceCredentialsAction(s.id)));
                }}
              >
                <Trash2 /> Remove saved password
              </Button>
            )}
          </div>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">Only the Super Admin can change the {s.name} sign-in.</p>
      )}
      {!workerOnline && (
        <p className="text-xs text-muted-foreground">The sync worker is offline, so tests and syncs wait until it is running.</p>
      )}
    </div>
  );
}
