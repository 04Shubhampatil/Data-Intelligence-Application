"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { setRolePermissionAction } from "./user-actions";

type RoleInfo = { name: string; label: string; description: string | null; permissions: string[]; users: number };

/** Permission matrix. Super Admin always has everything; others are editable by a Super Admin. */
export function RolesPanel({ roles, permissions, labels, canEdit }: { roles: RoleInfo[]; permissions: string[]; labels: Record<string, string>; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const toggle = (role: string, permission: string, enabled: boolean) =>
    start(async () => {
      const r = await setRolePermissionAction(role, permission, enabled);
      if (r?.ok) toast.success(r.message);
      else if (r?.error) toast.error(r.error);
    });

  return (
    <Card className="overflow-hidden py-0">
      <CardHeader className="border-b py-4">
        <CardTitle>Roles &amp; permissions</CardTitle>
        <CardDescription>
          What each role may do. Changes apply on the user&apos;s next request. District roles are additionally limited to their assigned districts in every query.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="bg-brand-navy text-left text-xs font-semibold uppercase tracking-wide text-white">
              <th className="px-4 py-3">Permission</th>
              {roles.map((r) => (
                <th key={r.name} className="px-3 py-3 text-center">
                  <div>{r.label}</div>
                  <div className="text-[10px] font-normal normal-case opacity-80">{r.users} user{r.users === 1 ? "" : "s"}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {permissions.map((p) => (
              <tr key={p} className="hover:bg-accent/40">
                <td className="px-4 py-2">
                  <p className="font-medium">{labels[p] ?? p}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{p}</p>
                </td>
                {roles.map((r) => {
                  const has = r.permissions.includes(p);
                  const locked = r.name === "SUPER_ADMIN" || !canEdit;
                  return (
                    <td key={r.name} className="px-3 py-2 text-center">
                      {locked ? (
                        has ? <Badge className="border-0 bg-success/10 text-success">✓</Badge> : <span className="text-muted-foreground">—</span>
                      ) : (
                        <Checkbox checked={has} disabled={pending} onCheckedChange={(c) => toggle(r.name, p, c === true)} aria-label={`${r.label}: ${labels[p] ?? p}`} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {pending && <p className="px-4 py-2 text-xs text-muted-foreground"><Loader2 className="mr-1 inline size-3 animate-spin" /> Saving…</p>}
      </CardContent>
    </Card>
  );
}
