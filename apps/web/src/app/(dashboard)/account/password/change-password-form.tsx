"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/forms/field";
import { changePasswordAction } from "@/app/(auth)/actions";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, undefined);
  // A successful change remounts the fields empty (key changes), so the old values never linger.
  const formKey = state?.ok ? "done" : "form";

  return (
    <form key={formKey} action={action} className="space-y-4" noValidate>
      {state?.ok && (
        <Alert className="border-success/30 bg-success/5 text-success">
          <CheckCircle2 />
          <AlertDescription className="text-success">{state.message}</AlertDescription>
        </Alert>
      )}
      {state?.error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <Field label="Current password" name="current" type="password" autoComplete="current-password" required errors={state?.fieldErrors?.current} />
      <Field label="New password" name="password" type="password" autoComplete="new-password" required minLength={12} errors={state?.fieldErrors?.password} />
      <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required errors={state?.fieldErrors?.confirm} />
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
