import "server-only";
import { z } from "zod";
import { prisma, type Prisma } from "@di/db";
import type { CurrentUser } from "@/server/auth/session";
import { hasPermission } from "@/lib/rbac";
import { maskTail } from "@/lib/format";
import { GROUP_BY, TOOL_ALIASES, TOOL_NAMES, toolSchemas, type GroupBy, type ToolName } from "./schemas";
import { describeFilters, filtersToWhere, FilterResolutionError } from "./resolve";
import { groupCandidates } from "@/server/services/report.service";
import { candidateScope, lookupScope } from "@/server/auth/scope";

/** A table the UI renders directly (never passes through the model). */
export type ResultTable = {
  resultId: string;
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
  total: number;
  exportable: boolean;
};
export type SummaryCard = { label: string; value: string | number; hint?: string };
export type ToolOutcome = {
  /** Compact payload sent back to the model. */
  forModel: unknown;
  /** Rich payload for the UI. */
  tables?: ResultTable[];
  cards?: SummaryCard[];
};

const ROW_SELECT = {
  sourceEmployeeCode: true,
  fullName: true,
  gender: true,
  employeeType: true,
  taluka: true,
  joiningDate: true,
  sourceStatus: true,
  docVerificationStatus: true,
  district: { select: { name: true } },
  departmentHead: { select: { name: true } },
  department: { select: { name: true } },
  subProject: { select: { name: true } },
  designation: { select: { name: true } },
} satisfies Prisma.CandidateSelect;

type Row = Prisma.CandidateGetPayload<{ select: typeof ROW_SELECT }>;

export const TABLE_COLUMNS = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "district", label: "District" },
  { key: "project", label: "Department / Project" },
  { key: "subProject", label: "Sub-project" },
  { key: "designation", label: "Designation" },
  { key: "employeeType", label: "Type" },
  { key: "gender", label: "Gender" },
  { key: "joiningDate", label: "Joined" },
  { key: "status", label: "Status" },
];

/** Projection shared by the UI table and the Excel export. Approved fields only; no contact data. */
export function projectRow(r: Row): Record<string, string | number | null> {
  return {
    code: r.sourceEmployeeCode,
    name: r.fullName,
    district: r.district?.name ?? null,
    project: r.departmentHead?.name ?? null,
    subProject: r.subProject?.name ?? null,
    designation: r.designation?.name ?? null,
    employeeType: r.employeeType,
    gender: r.gender,
    joiningDate: r.joiningDate ? r.joiningDate.toISOString().slice(0, 10) : null,
    status: r.sourceStatus,
  };
}

/** What the model is allowed to see per row: enough to summarise, no contact or location detail. */
function rowForModel(r: Row) {
  return { code: r.sourceEmployeeCode, name: r.fullName, district: r.district?.name, project: r.departmentHead?.name, designation: r.designation?.name };
}

const MODEL_ROW_CAP = 20;

/** Shared with the Reports page and dashboard. */
async function groupCounts(where: Prisma.CandidateWhereInput, by: GroupBy): Promise<{ label: string; count: number }[]> {
  return (await groupCandidates(where, by, 100)).map(({ label, count }) => ({ label, count }));
}

async function saveResult(user: CurrentUser, tool: ToolName, params: unknown, rowCount: number, title: string) {
  return (await prisma.assistantResult.create({ data: { userId: user.id, tool, params: params as object, rowCount, title } })).id;
}

/** Re-run a saved result without a row cap (used by the Excel export). Permissions re-checked by the caller. */
export async function rowsForResult(result: { tool: string; params: unknown }, user: CurrentUser) {
  const p = toolSchemas[result.tool === "generate_candidate_report" ? "generate_candidate_report" : "search_candidates"].parse(result.params);
  const where = await filtersToWhere(p.filters, user.districtScopeIds);
  const rows = await prisma.candidate.findMany({ where, select: ROW_SELECT, orderBy: [{ fullName: "asc" }], take: 50_000 });
  const groups = "groupBy" in p && p.groupBy ? await groupCounts(where, p.groupBy) : null;
  return { rows: rows.map(projectRow), groups, filters: describeFilters(p.filters) };
}

type Handler<N extends ToolName> = (args: z.infer<(typeof toolSchemas)[N]>, user: CurrentUser) => Promise<ToolOutcome>;

const handlers: { [N in ToolName]: Handler<N> } = {
  async search_candidates(args, user) {
    const where = await filtersToWhere(args.filters, user.districtScopeIds);
    const [total, rows] = await Promise.all([
      prisma.candidate.count({ where }),
      prisma.candidate.findMany({ where, select: ROW_SELECT, orderBy: [{ fullName: "asc" }], take: args.limit }),
    ]);
    const title = `Candidates — ${describeFilters(args.filters)}`;
    const resultId = await saveResult(user, "search_candidates", args, total, title);
    return {
      forModel: { total, shown: rows.length, note: total > rows.length ? "The user sees the first rows in a table; the full set is exportable." : undefined, rows: rows.slice(0, MODEL_ROW_CAP).map(rowForModel) },
      tables: [{ resultId, title, columns: TABLE_COLUMNS, rows: rows.map(projectRow), total, exportable: hasPermission(user.permissions, "reports:export") }],
    };
  },

  async count_candidates(args, user) {
    const where = await filtersToWhere(args.filters, user.districtScopeIds);
    const total = await prisma.candidate.count({ where });
    if (!args.groupBy) {
      return { forModel: { total, filters: describeFilters(args.filters) }, cards: [{ label: "Candidates", value: total, hint: describeFilters(args.filters) }] };
    }
    const groups = await groupCounts(where, args.groupBy);
    const resultId = await saveResult(user, "generate_candidate_report", { filters: args.filters, groupBy: args.groupBy, title: `Count by ${args.groupBy}` }, total, `Count by ${args.groupBy}`);
    return {
      forModel: { total, groupBy: args.groupBy, groups: groups.slice(0, 40) },
      cards: [{ label: "Total", value: total, hint: describeFilters(args.filters) }],
      tables: [
        {
          resultId,
          title: `Candidates by ${args.groupBy} — ${describeFilters(args.filters)}`,
          columns: [{ key: "label", label: args.groupBy }, { key: "count", label: "Candidates" }],
          rows: groups,
          total: groups.length,
          exportable: hasPermission(user.permissions, "reports:export"),
        },
      ],
    };
  },

  async get_candidate_details(args, user) {
    const scope = user.districtScopeIds.length ? { districtId: { in: user.districtScopeIds } } : {};
    const where: Prisma.CandidateWhereInput = args.employeeCode
      ? { sourceEmployeeCode: args.employeeCode.toUpperCase(), ...scope }
      : { fullName: { contains: args.nameContains }, ...scope };
    const canSeeContact = hasPermission(user.permissions, "candidates:read_contact");
    const matches = await prisma.candidate.findMany({ where: { ...where, isDeletedAtSource: false }, select: { ...ROW_SELECT, id: true, profile: canSeeContact }, take: 5 });
    if (!matches.length) return { forModel: { found: 0 } };
    if (matches.length > 1) {
      return { forModel: { found: matches.length, note: "Several candidates match; ask the user which one or use the employee code.", candidates: matches.map(rowForModel) } };
    }
    const c = matches[0];
    const row = projectRow(c);
    const detail = { ...row, taluka: c.taluka, documentVerification: c.docVerificationStatus, link: `/candidates/${c.id}` };
    // Contact fields: shown masked in the UI card only when the role allows; never sent to the model.
    const cards: SummaryCard[] = [
      { label: "Employee code", value: row.code ?? "—" },
      { label: "District / Taluka", value: `${row.district ?? "—"} / ${c.taluka ?? "—"}` },
      { label: "Designation", value: row.designation ?? "—" },
      { label: "Joined", value: row.joiningDate ?? "—" },
    ];
    if (canSeeContact && c.profile?.mobile) cards.push({ label: "Mobile", value: maskTail(c.profile.mobile) });
    return { forModel: { found: 1, candidate: detail }, cards };
  },

  async generate_candidate_report(args, user) {
    const where = await filtersToWhere(args.filters, user.districtScopeIds);
    const total = await prisma.candidate.count({ where });
    const groups = args.groupBy ? await groupCounts(where, args.groupBy) : null;
    const resultId = await saveResult(user, "generate_candidate_report", args, total, args.title);
    const exportable = hasPermission(user.permissions, "reports:export");
    const tables: ResultTable[] = [];
    if (groups) {
      tables.push({ resultId, title: `${args.title} — by ${args.groupBy}`, columns: [{ key: "label", label: args.groupBy! }, { key: "count", label: "Candidates" }], rows: groups, total: groups.length, exportable });
    } else {
      const sample = await prisma.candidate.findMany({ where, select: ROW_SELECT, orderBy: [{ fullName: "asc" }], take: 25 });
      tables.push({ resultId, title: args.title, columns: TABLE_COLUMNS, rows: sample.map(projectRow), total, exportable });
    }
    return {
      forModel: { total, groupBy: args.groupBy, groups: groups?.slice(0, 40), exportable, note: exportable ? "Tell the user the Excel download button is below the table." : "The user's role cannot export." },
      cards: [{ label: "Records in report", value: total, hint: describeFilters(args.filters) }],
      tables,
    };
  },

  async get_sync_status(_args, user) {
    const scope = user.districtScopeIds.length ? { districtId: { in: user.districtScopeIds } } : {};
    const [job, total, lastSync] = await Promise.all([
      prisma.syncJob.findFirst({ orderBy: { createdAt: "desc" }, select: { status: true, processed: true, totalRecords: true, created: true, updated: true, unchanged: true, failed: true, startedAt: true, finishedAt: true, filters: true } }),
      prisma.candidate.count({ where: { isDeletedAtSource: false, ...scope } }),
      prisma.sourceConnection.findFirst({ where: { isActive: true }, select: { lastSyncedAt: true, name: true } }),
    ]);
    const summary = { totalRecords: total, source: lastSync?.name, lastSyncedAt: lastSync?.lastSyncedAt?.toISOString() ?? null, latestJob: job };
    return {
      forModel: summary,
      cards: [
        { label: "Records in database", value: total },
        { label: "Latest job", value: job?.status ?? "Never run", hint: job ? `${job.processed}/${job.totalRecords} processed · ${job.failed} failed` : undefined },
        { label: "Last successful sync", value: lastSync?.lastSyncedAt ? lastSync.lastSyncedAt.toLocaleString("en-IN") : "—" },
      ],
    };
  },

  async list_filter_values(args, user) {
    const model = ({ district: "district", project: "departmentHead", department: "department", subProject: "subProject", designation: "designation" } as const)[args.kind as "district"];
    if (model) {
      const scopeWhere = args.kind === "district" ? (user.districtScopeIds.length ? { id: { in: user.districtScopeIds } } : {}) : lookupScope(user);
      const delegate = prisma[model] as unknown as { findMany(a: object): Promise<{ name: string }[]> };
      const rows = await delegate.findMany({ where: { ...scopeWhere, ...(args.contains ? { name: { contains: args.contains.toUpperCase() } } : {}) }, orderBy: { name: "asc" }, take: 60 });
      return { forModel: { kind: args.kind, values: rows.map((r) => r.name) } };
    }
    const field = args.kind as "employeeType" | "educationType";
    const rows = await prisma.candidate.findMany({ where: { [field]: { not: null }, ...candidateScope(user) }, distinct: [field], select: { [field]: true }, take: 60 });
    return { forModel: { kind: args.kind, values: rows.map((r) => (r as unknown as Record<string, string>)[field]) } };
  },
};

/** OpenAI tool definitions generated from the Zod schemas (single source of truth). */
export function toolDefinitions() {
  return TOOL_NAMES.map((name) => {
    const schema = toolSchemas[name];
    const json = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
    delete json.$schema;
    return { type: "function" as const, function: { name, description: schema.description ?? name, parameters: json } };
  });
}

export type ToolResult = { ok: true; outcome: ToolOutcome } | { ok: false; error: string };

/** Validates and runs one tool call. Unknown tools, bad arguments and unresolvable names become errors the model can read. */
export async function executeTool(rawName: string, rawArgs: unknown, user: CurrentUser): Promise<ToolResult> {
  const name = (TOOL_ALIASES[rawName] ?? rawName) as ToolName;
  if (!TOOL_NAMES.includes(name)) return { ok: false, error: `Unknown tool "${rawName}". Available: ${TOOL_NAMES.join(", ")}` };
  const parsed = toolSchemas[name].safeParse(rawArgs ?? {});
  if (!parsed.success) return { ok: false, error: `Invalid arguments: ${z.prettifyError(parsed.error).slice(0, 300)}` };
  try {
    const outcome = await (handlers[name] as Handler<ToolName>)(parsed.data as never, user);
    return { ok: true, outcome };
  } catch (err) {
    if (err instanceof FilterResolutionError) return { ok: false, error: err.message };
    console.error(`[ai tool ${name}]`, err instanceof Error ? err.message : err);
    return { ok: false, error: "The query failed. Try a simpler question." };
  }
}

export { GROUP_BY };
