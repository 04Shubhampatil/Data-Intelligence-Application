import { z } from "zod";
import { authorizeApi } from "@/server/auth/session";
import { listNotifications, markNotificationsRead } from "@/server/services/notification.service";

/** The signed-in user's own notifications (header bell). */
export async function GET() {
  const { user, error } = await authorizeApi("dashboard:read");
  if (error) return error;
  return Response.json(await listNotifications(user, 20), { headers: { "cache-control": "no-store" } });
}

const bodySchema = z.object({ ids: z.array(z.string().regex(/^[a-z0-9]{1,40}$/i)).max(100).optional() });

/** Marks notifications read â€” all of the user's, or the given ids (other users' rows are never affected). */
export async function POST(request: Request) {
  const { user, error } = await authorizeApi("dashboard:read");
  if (error) return error;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const count = await markNotificationsRead(user, parsed.data.ids);
  return Response.json({ ok: true, count });
}
