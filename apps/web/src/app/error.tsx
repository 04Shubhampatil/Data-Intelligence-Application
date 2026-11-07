"use client";

import { ErrorView } from "@/components/error-view";

/** Catches errors outside the app shell, including the shell's own layout (e.g. the database is unreachable). */
export default function RootError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView {...props} fullPage />;
}
