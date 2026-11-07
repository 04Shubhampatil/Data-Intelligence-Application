import { prisma } from "@di/db";
import { authorizeApi } from "@/server/auth/session";
import { rowsForResult } from "@/server/ai/tools";
import { buildCandidatesWorkbook } from "@/server/excel/candidates-workbook";
import { audit } from "@/server/security/audit";
import { rateLimit } from "@/server/security/rate-limit";

export async function GET(_req: Request, ctx: RouteContext<"/api/exports/[resultId]">) {
  const { user, error } = await authorizeApi("reports:export");
  if (error) return error;
  const { resultId } = await ctx.params;
  if (!/^[a-z0-9]{1,40}$/i.test(resultId)) return Response.json({ error: "Not found" }, { status: 404 });
  if (!rateLimit(`export:${user.id}`, 20, 10 * 60_000).ok) return Response.json({ error: "Too many exports. Please wait." }, { status: 429 });

  // A result can only be exported by the user who produced it; the query is re-run under their current permissions.
  const result = await prisma.assistantResult.findFirst({ where: { id: resultId, userId: user.id } });
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });

  const { rows, groups, filters } = await rowsForResult(result, user);
  const file = await buildCandidatesWorkbook({ title: result.title, filters, rows, groups, generatedBy: user.name ?? user.username });
  await audit("EXPORT", { userId: user.id, target: resultId, metadata: { rows: rows.length, tool: result.tool } });

  const safeName = result.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 60) || "export";
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
