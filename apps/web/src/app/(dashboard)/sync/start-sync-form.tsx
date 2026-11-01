"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { startSyncAction } from "./actions";

type Option = { value: string; label: string };

export function StartSyncForm({ sourceId, districts, disabled, disabledReason }: { sourceId: string; districts: Option[]; disabled: boolean; disabledReason?: string }) {
  const [state, action, pending] = useActionState(startSyncAction, undefined);
  const [scope, setScope] = useState<"all" | "district">(districts.length ? "district" : "all");
  const [district, setDistrict] = useState("");
  const [profiles, setProfiles] = useState(true);

  useEffect(() => {
    if (state?.ok) toast.success(state.message);
    else if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="sourceId" value={sourceId} />
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="district" value={district} />
      {profiles && <input type="hidden" name="includeProfiles" value="on" />}

      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">Scope</Label>
        <RadioGroup value={scope} onValueChange={(v) => setScope(v as "all" | "district")} className="gap-2">
          <label className="flex items-center gap-2.5 text-sm">
            <RadioGroupItem value="district" disabled={!districts.length} /> One district
            {!districts.length && <span className="text-xs text-muted-foreground">(list appears after the first sync)</span>}
          </label>
          <label className="flex items-center gap-2.5 text-sm">
            <RadioGroupItem value="all" /> All records
          </label>
        </RadioGroup>
      </div>

      {scope === "district" && (
        <div className="space-y-1.5">
          <Label htmlFor="district" className="text-xs font-semibold uppercase text-muted-foreground">District</Label>
          <Select value={district} onValueChange={setDistrict}>
            <SelectTrigger id="district" className="h-9 w-full max-w-xs bg-card">
              <SelectValue placeholder="Choose a district" />
            </SelectTrigger>
            <SelectContent>
              {districts.map((d) => (
                <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-start gap-2.5 text-sm">
          <Checkbox checked={profiles} onCheckedChange={(v) => setProfiles(v === true)} className="mt-0.5" />
          <span>
            Read profile pages
            <span className="block text-xs text-muted-foreground">Taluka, joining date, status, documents. Slower (~2.5 s per new record); profiles read in the last 7 days are skipped.</span>
          </span>
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="maxRecords" className="text-xs font-semibold uppercase text-muted-foreground">Trial cap (optional)</Label>
          <Input id="maxRecords" name="maxRecords" type="number" min={0} max={100000} placeholder="e.g. 50 — blank = no cap" className="h-9 max-w-xs bg-card" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={disabled || pending || (scope === "district" && !district)}>
          {pending ? <Loader2 className="animate-spin" /> : <Play />} Start sync
        </Button>
        {disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
      </div>
    </form>
  );
}
