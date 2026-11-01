import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FieldProps = ComponentProps<typeof Input> & { label: string; name: string; errors?: string[]; hint?: React.ReactNode };

export function Field({ label, name, errors, hint, ...input }: FieldProps) {
  const errorId = errors?.length ? `${name}-error` : undefined;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={name}>{label}</Label>
        {hint}
      </div>
      <Input id={name} name={name} aria-invalid={!!errorId} aria-describedby={errorId} className="h-10 bg-card" {...input} />
      {errorId && (
        <p id={errorId} className="text-xs text-destructive">
          {errors![0]}
        </p>
      )}
    </div>
  );
}
