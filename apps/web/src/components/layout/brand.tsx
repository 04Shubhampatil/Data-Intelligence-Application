import { BrainCircuit } from "lucide-react";

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-9 place-items-center rounded-xl bg-brand-navy text-white">
        <BrainCircuit className="size-5" />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-bold tracking-tight text-brand-navy">Data Intelligence</p>
        <p className="text-[11px] font-medium text-brand-orange">Resource Analytics</p>
      </div>
    </div>
  );
}
