import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { withBasePath } from "@/server/auth/auth-route";

// Auth.js expects the app's path prefix on the URL; see withBasePath.
export const GET = (req: NextRequest) => handlers.GET(withBasePath(req));
export const POST = (req: NextRequest) => handlers.POST(withBasePath(req));
