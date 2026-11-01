import type { LucideIcon } from "lucide-react";
import { CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Honest placeholder for features scheduled in a later phase. */
export function PhasePlaceholder({
  icon: Icon,
  phase,
  title,
  description,
  features,
}: {
  icon: LucideIcon;
  phase: string;
  title: string;
  description: string;
  features: string[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-brand-teal">
          <Icon className="size-5" />
        </div>
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{title}</CardTitle>
            <Badge variant="secondary" className="gap-1">
              <Clock className="size-3" /> {phase}
            </Badge>
          </div>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 sm:grid-cols-2">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-teal/60" />
              {f}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
