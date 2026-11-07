import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const callbackUrl = typeof sp.callbackUrl === "string" ? sp.callbackUrl : undefined;
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-brand-navy">Welcome back</h2>
        <p className="text-sm text-muted-foreground">Sign in with your administrator account.</p>
      </div>
      <LoginForm callbackUrl={callbackUrl} reset={sp.reset === "1"} ended={sp.ended === "1"} />
    </div>
  );
}
