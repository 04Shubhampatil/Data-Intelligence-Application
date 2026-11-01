"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/forms/field";
import { forgotPasswordAction } from "../actions";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(forgotPasswordAction, undefined);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-brand-navy">Reset your password</h2>
        <p className="text-sm text-muted-foreground">Enter your account email and we&apos;ll send you a reset link.</p>
      </div>

      {state?.message ? (
        <Alert>
          <MailCheck />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : (
        <form action={action} className="space-y-4" noValidate>
          <Field label="Email" name="email" type="email" autoComplete="email" required autoFocus errors={state?.fieldErrors?.email} />
          <Button type="submit" size="lg" className="h-10 w-full" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Send reset link
          </Button>
        </form>
      )}

      <Link href="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft className="size-4" /> Back to sign in
      </Link>
    </div>
  );
}
