import type { Metadata } from "next";
import { Bot, Database, KeyRound, ShieldCheck, Users } from "lucide-react";
import { prisma, parsePermissions, PERMISSIONS, PERMISSION_LABELS, ROLE_LABELS, isRoleName } from "@di/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/server/auth/session";
import { aiConfig } from "@/server/ai/client";
import { getLastCleanup, getRetentionSettings, listSuppressed } from "@di/db/retention";
import { listBackups } from "@/server/services/backup.service";
import { getSources } from "@/server/services/sync.service";
import { RetentionPanel } from "./retention-panel";
import { isLockedNow } from "@/server/services/sync.service";
import { UsersPanel } from "./users-panel";
import { RolesPanel } from "./roles-panel";
import { DocumentPolicyPanel } from "./document-policy-panel";
import { DOCUMENT_DEFS, DOCUMENT_KINDS } from "@di/core";
import { formatDateTime, roleLabel } from "@/lib/format";
import { hasPermission } from "@/lib/rbac";
import { sourceCommands } from "@/lib/source-commands";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser("settings:read");
  const canManageAll = hasPermission(user.permissions, "users:manage");
  const canManageUsers = canManageAll || hasPermission(user.permissions, "users:manage_district");
  const ai = aiConfig();
  const [retention, lastCleanup, suppressedRows, backups, sources] = await Promise.all([getRetentionSettings(), getLastCleanup(), listSuppressed(), listBackups(), getSources()]);
  // A blocked code is stored once per source; show it once.
  const suppressed = suppressedRows.filter((r, i, all) => all.findIndex((x) => x.sourceEmployeeCode === r.sourceEmployeeCode) === i);
  const [roles, users] = await Promise.all([
    prisma.role.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { users: true } } } }),
    canManageUsers
      ? prisma.user.findMany({
          // District Admins see only District Viewers in their own districts (plus themselves for context).
          where: canManageAll
            ? {}
            : { OR: [{ id: user.id }, { role: { name: "DISTRICT_VIEWER" }, districtAssignments: { some: { districtId: { in: user.districtScopeIds } } } }] },
          orderBy: { createdAt: "asc" },
          select: {
            id: true, name: true, username: true, isActive: true, lastLoginAt: true, lockedUntil: true, role: { select: { name: true } },
            districtAssignments: { select: { district: { select: { id: true, name: true } } } },
          },
        })
      : Promise.resolve([]),
  ]);
  const districts = await prisma.district.findMany({
    where: hasPermission(user.permissions, "districts:assign") ? {} : { id: { in: user.districtScopeIds } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const docPolicies = sources[0]
    ? await prisma.documentPolicy.findMany({ where: { sourceConnectionId: sources[0].id }, select: { kind: true, allowed: true } })
    : [];
  const docRows = DOCUMENT_KINDS.map((kind) => ({ kind, label: DOCUMENT_DEFS[kind].label, identity: DOCUMENT_DEFS[kind].identity, allowed: docPolicies.find((p) => p.kind === kind)?.allowed ?? DOCUMENT_DEFS[kind].defaultAllowed }));
  const assignableRoles = canManageAll ? ["ADMIN", "DISTRICT_ADMIN", "DISTRICT_VIEWER", "VIEWER"] : canManageUsers ? ["DISTRICT_VIEWER"] : [];

  return (
    <>
      <PageHeader title="Settings" description="Source connection, AI, users, roles and data retention." />
      <Tabs defaultValue={canManageUsers ? "users" : "roles"}>
        <TabsList className="mb-4 flex-wrap">
          {canManageUsers && (
            <TabsTrigger value="users">
              <Users /> Users
            </TabsTrigger>
          )}
          <TabsTrigger value="roles">
            <ShieldCheck /> Roles & permissions
          </TabsTrigger>
          <TabsTrigger value="source">
            <KeyRound /> Source connection
          </TabsTrigger>
          <TabsTrigger value="ai">
            <Bot /> AI configuration
          </TabsTrigger>
          <TabsTrigger value="retention">
            <Database /> Data retention
          </TabsTrigger>
        </TabsList>

        {canManageUsers && (
          <TabsContent value="users">
            <UsersPanel
              currentUserId={user.id}
              districts={districts}
              assignableRoles={assignableRoles}
              canAssignAnyDistrict={hasPermission(user.permissions, "districts:assign")}
              users={users.map((u) => ({
                id: u.id, name: u.name, username: u.username, isActive: u.isActive, lastLoginAt: u.lastLoginAt, role: u.role.name, lockedUntil: u.lockedUntil, isLocked: isLockedNow(u.lockedUntil),
                districts: u.districtAssignments.map((a) => a.district),
              }))}
            />
          </TabsContent>
        )}

        <TabsContent value="roles">
          <RolesPanel
            canEdit={canManageAll}
            permissions={[...PERMISSIONS]}
            labels={PERMISSION_LABELS}
            roles={roles.map((r) => ({
              name: r.name,
              label: isRoleName(r.name) ? ROLE_LABELS[r.name] : roleLabel(r.name),
              description: r.description,
              permissions: parsePermissions(r.permissions),
              users: r._count.users,
            }))}
          />
        </TabsContent>

        <TabsContent value="source">
          <Card>
            <CardHeader>
              <CardTitle>Source dashboard connection</CardTitle>
              <CardDescription>Managed from the server command line so that no source credential ever passes through the browser. Status and approved fields are shown on Data Synchronization.</CardDescription>
            </CardHeader>
            <CardContent>
              {sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">No source configured. Run <code className="font-mono">npm run source:setup</code> on the server.</p>
              ) : (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  {sources.map((s) => (
                    <div key={s.id} className="contents">
                      <div><dt className="text-muted-foreground">Name</dt><dd className="font-medium">{s.name}</dd></div>
                      <div><dt className="text-muted-foreground">URL</dt><dd className="font-mono text-xs">{s.baseUrl}</dd></div>
                      <div><dt className="text-muted-foreground">Sign-in</dt><dd className="font-medium">Manual session (no password stored){s.sessionSavedAt ? ` · saved ${formatDateTime(s.sessionSavedAt)}` : " · not signed in"}</dd></div>
                      <div><dt className="text-muted-foreground">Approved fields</dt><dd className="font-medium">{s.fieldPolicies.filter((f) => f.allowed).length} of {s.fieldPolicies.length}</dd></div>
                    </div>
                  ))}
                </dl>
              )}
              <p className="mt-4 text-xs text-muted-foreground">
                Commands: {sources.map((s, i) => (<span key={s.id}>{i > 0 && ", "}<code className="font-mono">{sourceCommands(s.adapterKey).login}</code> (sign in to {s.name})</span>))}, <code className="font-mono">npm run source:session:export</code> / <code className="font-mono">import</code> (move a session to the server). Field approvals are changed in the <code className="font-mono">FieldPolicy</code> table by a Super Admin after the data owner signs them off.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
        {sources[0] && (
          <TabsContent value="source">
            <div className="mt-6">
              <DocumentPolicyPanel sourceId={sources[0].id} rows={docRows} canEdit={hasPermission(user.permissions, "settings:write")} />
            </div>
          </TabsContent>
        )}
        <TabsContent value="ai">
          <Card>
            <CardHeader>
              <CardTitle>AI configuration</CardTitle>
              <CardDescription>Read from server environment variables. The API key is never shown or sent to the browser.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Status</dt><dd className="font-medium">{ai.configured ? "Configured" : "Not configured (OPENAI_API_KEY empty)"}</dd></div>
                <div><dt className="text-muted-foreground">Provider</dt><dd className="font-medium">{ai.provider}</dd></div>
                <div><dt className="text-muted-foreground">Model</dt><dd className="font-mono text-xs">{ai.model}</dd></div>
                <div><dt className="text-muted-foreground">Endpoint</dt><dd className="font-mono text-xs">{ai.baseURL ?? "api.openai.com"}</dd></div>
              </dl>
              <p className="mt-4 text-xs text-muted-foreground">
                The assistant can only call six read-only tools over approved fields. Rows sent to the model are capped at 20 per answer and never include contact, identity, bank or salary data. Every question is audit-logged.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="retention">
          <RetentionPanel settings={retention} lastCleanup={lastCleanup} suppressed={suppressed} backups={backups.files} backupDir={backups.dir} backupAgeH={backups.latestAgeHours} canWrite={hasPermission(user.permissions, "settings:write")} />
        </TabsContent>
      </Tabs>
    </>
  );
}
