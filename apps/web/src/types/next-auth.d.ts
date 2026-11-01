import type { DefaultSession } from "next-auth";
import type { Permission } from "@di/db/permissions";

declare module "next-auth" {
  interface User {
    role?: string;
    permissions?: Permission[];
  }
  interface Session {
    user: {
      id: string;
      role: string;
      permissions: Permission[];
    } & DefaultSession["user"];
  }
}
