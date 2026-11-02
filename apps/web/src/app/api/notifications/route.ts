import { z } from "zod";
import { authorizeApi } from "@/server/auth/session";
import { listNotifications, markNotificationsRead } from "@/server/services/notification.service";
import { rateLimit } from "@/server/security/rate-limit";

const tooMany = () => Response.json({ error: "Too many requests." }, { status: 429 });

/** The signed-in user's own notifications (header bell). */
export async function GET() {
  const { user, error } = await authorizeApi("dashboard:read");
  if (error) return error;
  if (!rateLimit(`notif:get:${user.id}`, 300, 10 * 60_000).ok) return tooMany();
  return Response.json(await listNotifications(user, 20), { headers: { "cache-control": "no-store" } });
}

const bodySchema = z.object({ ids: z.array(z.string().regex(/^[a-z0-9]{1,40}$/i)).max(100).optional() });

/** Marks notifications read — all of the user's, or the given ids (other users' rows are never affected). */
export async function POST(request: Request) {
  const { user, error } = await authorizeApi("dashboard:read");
  if (error) return error;
  if (!rateLimit(`notif:post:${user.id}`, 120, 10 * 60_000).ok) return tooMany();
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const count = await markNotificationsRead(user, parsed.data.ids);
  return Response.json({ ok: true, count });
}
