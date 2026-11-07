"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { KeyRound, Loader2, MapPin, UserCheck, UserPlus, UserX } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime, roleLabel } from "@/lib/format";
import { createUserAction, resetUserPasswordAction, setUserActiveAction, setUserDistrictsAction, setUserRoleAction, type UserActionState } from "./user-actions";

export type UserRow = {
  id: string;
  name: string | null;
  username: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  role: string;
  lockedUntil: Date | null;
  /** Computed on the server at request time (lockedUntil in the future). */
  isLocked: boolean;
  districts: { id: string; name: string }[];
};
type Option = { id: string; name: string };
type RoleOption = { value: string; label: string; hint: string; districts: "none" | "one" | "many" | "optional" };

const ROLE_OPTIONS: RoleOption[] = [
  { value: "ADMIN", label: "Admin", hint: "all districts, syncs, exports, reviews", districts: "none" },
  { value: "DISTRICT_ADMIN", label: "District Admin", hint: "assigned districts, monitors reviews", districts: "many" },
  { value: "DISTRICT_VIEWER", label: "District Viewer", hint: "one district, reviews candidates", districts: "one" },
  { value: "VIEWER", label: "Viewer", hint: "read-only", districts: "optional" },
];

function useToast(state: UserActionState) {
  useEffect(() => {
    if (state?.ok) toast.success(state.message);
    else if (state?.error) toast.error(state.error);
  }, [state]);
}

export function UsersPanel({ users, currentUserId, districts, assignableRoles, canAssignAnyDistrict }: { users: UserRow[]; currentUserId: string; districts: Option[]; assignableRoles: string[]; canAssignAnyDistrict: boolean }) {
  const [showForm, setShowForm] = useState(false);
  const roleOptions = ROLE_OPTIONS.filter((r) => assignableRoles.includes(r.value));
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            Create users, set their role and district assignment, disable them, or set a new password. Super Admin accounts are managed outside this screen.
            {!canAssignAnyDistrict && " You can only manage District Viewers in your own districts."}
          </CardDescription>
        </div>
        {roleOptions.length > 0 && (
          <Button size="sm" variant={showForm ? "outline" : "default"} onClick={() => setShowForm((v) => !v)}>
            <UserPlus /> {showForm ? "Close" : "New user"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {showForm && <CreateUserForm roleOptions={roleOptions} districts={districts} onDone={() => setShowForm(false)} />}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">User</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Districts</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Last sign-in</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => (
                <UserRowItem key={u.id} u={u} isSelf={u.id === currentUserId} districts={districts} roleOptions={roleOptions} />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function DistrictPicker({ districts, value, onChange, mode }: { districts: Option[]; value: string[]; onChange: (v: string[]) => void; mode: RoleOption["districts"] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => districts.filter((d) => d.name.toLowerCase().includes(q.toLowerCase())), [districts, q]);
  if (mode === "none") return <p className="text-xs text-muted-foreground">This role is global; district assignment doesn&apos;t apply.</p>;
  if (mode === "one") {
    return (
      <Select value={value[0] ?? ""} onValueChange={(v) => onChange([v])}>
        <SelectTrigger className="h-9 w-full bg-card"><SelectValue placeholder="Choose the district" /></SelectTrigger>
        <SelectContent>
          {districts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  return (
    <div className="rounded-lg border bg-card">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter districts…" className="h-8 rounded-b-none border-0 border-b shadow-none focus-visible:ring-0" />
      <div className="grid max-h-40 grid-cols-2 gap-x-3 overflow-auto p-2 sm:grid-cols-3">
        {shown.map((d) => (
          <label key={d.id} className="flex items-center gap-2 py-0.5 text-sm">
            <Checkbox checked={value.includes(d.id)} onCheckedChange={(c) => onChange(c === true ? [...value, d.id] : value.filter((x) => x !== d.id))} /> {d.name}
          </label>
        ))}
        {shown.length === 0 && <p className="col-span-full text-xs text-muted-foreground">No districts match.</p>}
      </div>
      <p className="border-t px-2 py-1 text-[11px] text-muted-foreground">{value.length} selected{mode === "optional" ? " · leave empty for all districts" : ""}</p>
    </div>
  );
}

function UserRowItem({ u, isSelf, districts, roleOptions }: { u: UserRow; isSelf: boolean; districts: Option[]; roleOptions: RoleOption[] }) {
  const [pending, start] = useTransition();
  const [panel, setPanel] = useState<"none" | "password" | "districts">("none");
  const [draft, setDraft] = useState<string[]>(u.districts.map((d) => d.id));
  const locked = u.isLocked;
  const editable = !isSelf && u.role !== "SUPER_ADMIN" && roleOptions.some((r) => r.value === u.role);
  const mode = ROLE_OPTIONS.find((r) => r.value === u.role)?.districts ?? "optional";

  const run = (fn: () => Promise<UserActionState>) =>
    start(async () => {
      const r = await fn();
      if (r?.ok) toast.success(r.message);
      else if (r?.error) toast.error(r.error);
    });

  return (
    <>
      <tr className={!u.isActive ? "opacity-60" : undefined}>
        <td className="py-2.5 pr-4">
          <p className="font-medium">{u.name ?? "—"} {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}</p>
          <p className="text-xs text-muted-foreground">{u.username}</p>
        </td>
        <td className="py-2.5 pr-4">
          {editable ? (
            <Select value={u.role} onValueChange={(v) => run(() => setUserRoleAction(u.id, v))} disabled={pending}>
              <SelectTrigger className="h-8 w-40 bg-card"><SelectValue /></SelectTrigger>
              <SelectContent>
                {roleOptions.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            roleLabel(u.role)
          )}
        </td>
        <td className="py-2.5 pr-4">
          {mode === "none" ? (
            <span className="text-xs text-muted-foreground">All</span>
          ) : u.districts.length === 0 ? (
            <span className={mode === "optional" ? "text-xs text-muted-foreground" : "text-xs font-medium text-destructive"}>{mode === "optional" ? "All" : "Not assigned"}</span>
          ) : (
            <div className="flex max-w-xs flex-wrap gap-1">
              {u.districts.slice(0, 4).map((d) => <Badge key={d.id} variant="secondary" className="font-normal">{d.name}</Badge>)}
              {u.districts.length > 4 && <Badge variant="outline">+{u.districts.length - 4}</Badge>}
            </div>
          )}
        </td>
        <td className="py-2.5 pr-4">
          <Badge className={u.isActive ? "border-0 bg-success/10 text-success" : "border-0 bg-muted text-muted-foreground"}>{u.isActive ? "Active" : "Disabled"}</Badge>
          {locked && <Badge className="ml-1 border-0 bg-brand-orange/15 text-brand-orange">Locked</Badge>}
        </td>
        <td className="py-2.5 pr-4">{formatDateTime(u.lastLoginAt)}</td>
        <td className="py-2.5 text-right">
          {editable && (
            <div className="flex justify-end gap-1.5">
              {mode !== "none" && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => setPanel(panel === "districts" ? "none" : "districts")}>
                  <MapPin /> Districts
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={pending} onClick={() => setPanel(panel === "password" ? "none" : "password")}>
                <KeyRound /> Password
              </Button>
              <Button size="sm" variant={u.isActive ? "destructive" : "default"} disabled={pending} onClick={() => run(() => setUserActiveAction(u.id, !u.isActive))}>
                {pending ? <Loader2 className="animate-spin" /> : u.isActive ? <UserX /> : <UserCheck />} {u.isActive ? "Disable" : "Enable"}
              </Button>
            </div>
          )}
        </td>
      </tr>
      {panel === "password" && editable && (
        <tr><td colSpan={6} className="pb-3"><ResetPasswordForm userId={u.id} name={u.name ?? u.username} onDone={() => setPanel("none")} /></td></tr>
      )}
      {panel === "districts" && editable && (
        <tr>
          <td colSpan={6} className="pb-3">
            <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
              <p className="text-sm font-medium">Districts for {u.name ?? u.username}</p>
              <DistrictPicker districts={districts} value={draft} onChange={setDraft} mode={mode} />
              <div className="flex gap-2">
                <Button size="sm" disabled={pending} onClick={() => run(async () => { const r = await setUserDistrictsAction(u.id, draft); if (r?.ok) setPanel("none"); return r; })}>
                  {pending ? <Loader2 className="animate-spin" /> : <MapPin />} Save districts
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setDraft(u.districts.map((d) => d.id)); setPanel("none"); }}>Cancel</Button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function CreateUserForm({ roleOptions, districts, onDone }: { roleOptions: RoleOption[]; districts: Option[]; onDone: () => void }) {
  const [state, action, pending] = useActionState(createUserAction, undefined);
  const [role, setRole] = useState(roleOptions[0]?.value ?? "VIEWER");
  const [picked, setPicked] = useState<string[]>([]);
  const mode = ROLE_OPTIONS.find((r) => r.value === role)?.districts ?? "optional";
  useToast(state);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
  // Adjust the district selection when the role changes (no effect: avoids re-render loops).
  const onRoleChange = (next: string) => {
    const nextMode = ROLE_OPTIONS.find((r) => r.value === next)?.districts ?? "optional";
    setRole(next);
    if (nextMode === "none") setPicked([]);
    else if (nextMode === "one") setPicked((p) => p.slice(0, 1));
  };

  return (
    <form action={action} className="space-y-3 rounded-xl border bg-muted/30 p-4">
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="districtIds" value={picked.join(",")} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="nu-name">Name</Label>
          <Input id="nu-name" name="name" required minLength={2} maxLength={80} className="h-9 bg-card" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nu-username">Username</Label>
          <Input id="nu-username" name="username" type="text" required minLength={3} maxLength={50} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" autoCapitalize="none" spellCheck={false} autoComplete="off" className="h-9 bg-card" />
          <p className="text-[11px] text-muted-foreground">Letters, numbers, dot, dash, underscore. Used to sign in.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nu-password">Password</Label>
          <Input id="nu-password" name="password" type="password" required minLength={12} autoComplete="new-password" className="h-9 bg-card" />
          <p className="text-[11px] text-muted-foreground">12+ characters, upper & lower case, a number.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select value={role} onValueChange={onRoleChange}>
            <SelectTrigger className="h-9 w-full bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              {roleOptions.map((r) => <SelectItem key={r.value} value={r.value}>{r.label} — {r.hint}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>{mode === "one" ? "Assigned district" : "Assigned districts"}</Label>
        <DistrictPicker districts={districts} value={picked} onChange={setPicked} mode={mode} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || ((mode === "one" || mode === "many") && picked.length === 0)}>
          {pending ? <Loader2 className="animate-spin" /> : <UserPlus />} Create user
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function ResetPasswordForm({ userId, name, onDone }: { userId: string; name: string; onDone: () => void }) {
  const [state, action, pending] = useActionState(resetUserPasswordAction, undefined);
  useToast(state);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 rounded-xl border bg-muted/30 p-3">
      <input type="hidden" name="userId" value={userId} />
      <div className="space-y-1.5">
        <Label htmlFor={`pw-${userId}`}>New password for {name}</Label>
        <Input id={`pw-${userId}`} name="password" type="password" required minLength={12} autoComplete="new-password" className="h-9 w-72 bg-card" />
      </div>
      <Button type="submit" size="sm" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <KeyRound />} Set password</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
    </form>
  );
}
