import { mahahrdAdapter } from "./mahahrd";
import type { SourceAdapter } from "./types";

const ADAPTERS: Record<string, SourceAdapter> = { [mahahrdAdapter.key]: mahahrdAdapter };

export function getAdapter(key: string): SourceAdapter {
  const a = ADAPTERS[key];
  if (!a) throw new Error(`Unknown adapter "${key}"`);
  return a;
}
