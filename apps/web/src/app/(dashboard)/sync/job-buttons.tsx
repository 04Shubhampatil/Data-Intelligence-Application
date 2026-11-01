"use client";

import { useTransition } from "react";
import { Loader2, Play, RotateCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelSyncAction, resumeSyncAction, retryFailedAction } from "./actions";

function ActionButton({ label, icon, run, variant = "outline" }: { label: string; icon: React.ReactNode; run: () => Promise<void>; variant?: "outline" | "destructive" | "default" }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant={variant} disabled={pending} onClick={() => start(run)}>
      {pending ? <Loader2 className="animate-spin" /> : icon} {label}
    </Button>
  );
}

export function JobButtons({ jobId, canCancel, canResume, retryCount }: { jobId: string; canCancel: boolean; canResume: boolean; retryCount: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      {canCancel && <ActionButton label="Cancel" icon={<Square />} variant="destructive" run={() => cancelSyncAction(jobId)} />}
      {canResume && <ActionButton label="Resume" icon={<Play />} variant="default" run={() => resumeSyncAction(jobId)} />}
      {retryCount > 0 && <ActionButton label={`Retry ${retryCount} failed`} icon={<RotateCw />} run={() => retryFailedAction(jobId)} />}
    </div>
  );
}
