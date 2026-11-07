"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, Loader2, LogIn } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/forms/field";
import { loginAction } from "../actions";

export function LoginForm({ callbackUrl, reset }: { callbackUrl?: string; reset?: boolean }) {
  const [state, action, pending] = useActionState(loginAction, undefined);

  return (
    <form action={action} className="space-y-4" noValidate>
      {reset && !state && (
        <Alert className="border-success/30 bg-success/5 text-success">
          <CheckCircle2 />
          <AlertDescription className="text-success">Password updated. Sign in with your new password.</AlertDescription>
        </Alert>
      )}
      {state?.error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/"} />
      <Field
        label="Username"
        name="username"
        type="text"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        autoFocus
        defaultValue={state?.username}
        errors={state?.fieldErrors?.username}
      />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required errors={state?.fieldErrors?.password} />

      <Button type="submit" size="lg" className="h-10 w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <LogIn />}
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
