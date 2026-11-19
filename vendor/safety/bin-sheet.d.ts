/* COPY of sites/_shared/safety/bin-sheet.d.ts — edit the source there and run node _shared/sync.mjs */
import type { RestorePlan } from './bin.js';
export interface BinSheetEntry { id: string; kind: string; label: string; deleted_at: string }
type Result = { ok?: boolean; error?: string } | void | unknown;
export function openBin(opts: {
  title?: string;
  load: () => Promise<BinSheetEntry[]>;
  restore: (e: BinSheetEntry) => Promise<Result>;
  forget?: (e: BinSheetEntry) => Promise<Result>;
  kinds?: Record<string, string>;
}): Promise<number>;
export function openRestore<B = any>(opts: {
  title?: string;
  read: (file: File) => Promise<B>;
  plan: (backup: B) => Promise<Record<string, RestorePlan<any>>>;
  apply: (plan: Record<string, RestorePlan<any>>) => Promise<Result>;
  names?: Record<string, [string, string]>;
  accept?: string;
}): Promise<boolean>;
