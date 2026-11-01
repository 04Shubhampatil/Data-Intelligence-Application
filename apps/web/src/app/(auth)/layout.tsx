import { BrainCircuit, Database, ShieldCheck, Sparkles } from "lucide-react";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-brand-navy text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -right-32 -top-32 size-[28rem] rounded-full bg-brand-teal/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-24 size-[24rem] rounded-full bg-brand-orange/20 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <BrainCircuit className="size-5" />
          </div>
          <span className="text-lg font-bold tracking-tight">Data Intelligence</span>
        </div>

        <div className="relative max-w-md space-y-6">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">
            Resource records, synced and searchable in plain language.
          </h1>
          <ul className="space-y-4 text-sm text-white/80">
            <li className="flex gap-3">
              <Database className="mt-0.5 size-4 shrink-0 text-brand-orange" />
              Approved fields only, kept in your own database.
            </li>
            <li className="flex gap-3">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-orange" />
              Ask questions like &ldquo;How many engineers in Kolhapur?&rdquo; and export the answer.
            </li>
            <li className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-orange" />
              Role-based access and a full audit trail.
            </li>
          </ul>
        </div>

        <p className="relative text-xs text-white/50">Authorized personnel only. All activity is logged.</p>
      </aside>

      <main className="flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
