import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/server/auth/session";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Change password" };

/** Every signed-in user can change their own password (current password required). */
export default async function ChangePasswordPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Change password" description={`Signed in as ${user.username}`} />
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">New password</CardTitle>
          <CardDescription>At least 12 characters, with upper and lower case letters and a number.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </>
  );
}
