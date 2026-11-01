import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Access denied" };

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
        <ShieldAlert className="size-7" />
      </div>
      <h1 className="text-2xl font-bold text-brand-navy">Access denied</h1>
      <p className="max-w-sm text-sm text-muted-foreground">Your role doesn&apos;t have permission to view this page. Ask a Super Admin if you need access.</p>
      <Button asChild>
        <Link href="/">Back to dashboard</Link>
      </Button>
    </main>
  );
}
