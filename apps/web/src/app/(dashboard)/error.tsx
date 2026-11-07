"use client";

import { ErrorView } from "@/components/error-view";

/** Catches a page's error inside the app shell, so the sidebar and header stay usable. */
export default function DashboardError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView {...props} />;
}
