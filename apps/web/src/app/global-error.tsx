"use client";

import "./globals.css";
import { ErrorView } from "@/components/error-view";

/** Last resort: the root layout itself failed, so this page brings its own <html> and <body>. */
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <title>Something went wrong · Data Intelligence</title>
        <ErrorView {...props} fullPage />
      </body>
    </html>
  );
}
