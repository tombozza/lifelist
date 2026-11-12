/* COPY of sites/_shared/ai-protocol/updates-sheet.d.ts — edit the source there and run node _shared/sync.mjs */
// Types for updates-sheet.js. Source: sites/_shared/ai-protocol/.
import type { AppSchema, Item, AppliedLog } from './protocol.js';

export interface Resolved { ok: boolean; text?: string; reason?: string; options?: { value: string; label: string }[] }
export interface ApplyResult { ok: boolean; item: Item; value?: unknown; error?: string }
export function openUpdates(o: {
  schema: AppSchema;
  context?: () => { data: unknown; note?: string };
  resolve?: (item: Item) => Promise<Resolved> | Resolved;
  apply: (item: Item, choice?: string) => Promise<unknown> | unknown;
  done?: (results: ApplyResult[]) => void;
  text?: string;
  log?: AppliedLog;
}): Promise<(ApplyResult | null)[] | null>;
export function copyContext(schema: AppSchema, context: () => { data: unknown; note?: string }): Promise<void>;
