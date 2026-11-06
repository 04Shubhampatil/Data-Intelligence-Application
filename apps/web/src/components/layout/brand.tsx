import { BrainCircuit } from "lucide-react";
import { cn } from "@/lib/utils";

/** Logo + name. `tone="dark"` for the navy sidebar, `"light"` for light surfaces (mobile header). */
export function Brand({ tone = "light" }: { tone?: "light" | "dark" }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-10 place-items-center rounded-full border border-white/15 bg-[#1e2a5e] text-slate-200 shadow-md shadow-blue-950/40">
        <BrainCircuit className="size-5" strokeWidth={2} />
      </div>
      <div className="leading-tight">
        <p className={cn("text-[15px] font-bold tracking-tight", tone === "dark" ? "text-white" : "text-brand-navy")}>
          Data <span className="block -mt-0.5">Intelligence</span>
        </p>
        <p className={cn("text-[10px] font-medium", tone === "dark" ? "text-white/55" : "text-muted-foreground")}>Resource Analytics</p>
      </div>
    </div>
  );
}
