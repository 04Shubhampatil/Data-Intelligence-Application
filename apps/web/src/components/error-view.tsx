"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Home, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusScreen } from "@/components/status-screen";

/** Shared body of the error boundaries: retry re-fetches the page from the server, not just re-renders. */
export function ErrorView({
  error,
  reset,
  fullPage = false,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  fullPage?: boolean;
}) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  useEffect(() => {
    console.error(error);
  }, [error]);

  const retry = () =>
    startRetry(() => {
      router.refresh();
      reset();
    });

  return (
    <StatusScreen
      fullPage={fullPage}
      tone="danger"
      icon={AlertTriangle}
      title="Something went wrong"
      description="This page couldn't load because of a problem on our side. Nothing you entered was lost. Try again, and if it keeps happening, share the reference below with your administrator."
      reference={error.digest}
      actions={
        <>
          <Button onClick={retry} disabled={retrying}>
            {retrying ? <Loader2 className="animate-spin" /> : <RotateCw />}
            {retrying ? "Retrying…" : "Try again"}
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">
              <Home />
              Go to dashboard
            </Link>
          </Button>
        </>
      }
    />
  );
}
