import type { Metadata } from "next";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ params }: PageProps<"/reset-password/[token]">) {
  const { token } = await params;
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-brand-navy">Choose a new password</h2>
        <p className="text-sm text-muted-foreground">At least 12 characters, with upper- and lowercase letters and a number.</p>
      </div>
      <ResetForm token={token} />
    </div>
  );
}
