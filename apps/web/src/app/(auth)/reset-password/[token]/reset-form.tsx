"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/forms/field";
import { resetPasswordAction } from "../../actions";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, undefined);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state?.error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>
            {state.error}{" "}
            <Link href="/forgot-password" className="font-medium underline">
              Request a new link
            </Link>
          </AlertDescription>
        </Alert>
      )}
      <input type="hidden" name="token" value={token} />
      <Field label="New password" name="password" type="password" autoComplete="new-password" required errors={state?.fieldErrors?.password} />
      <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required errors={state?.fieldErrors?.confirm} />
      <Button type="submit" size="lg" className="h-10 w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Update password
      </Button>
    </form>
  );
}
