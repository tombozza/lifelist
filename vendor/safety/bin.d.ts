/* COPY of sites/_shared/safety/bin.d.ts — edit the source there and run node _shared/sync.mjs */
export const BIN_DAYS: number;
export interface BinEntry<T = unknown> { id: string; kind: string; label: string; deleted_at: string; data?: T }
export function binId(): string;
export function binEntry<T>(kind: string, label: string, data: T, opts?: { now?: number; id?: string }): BinEntry<T>;
export function pruneBin<E extends { deleted_at: string }>(entries: E[], opts?: { now?: number; days?: number }): E[];
export function binAge(entry: { deleted_at: string }, opts?: { now?: number; days?: number }): { ago: string; left: string };
export interface RestorePlan<T> { add: T[]; already: number }
export function restoreMissing<T>(current: T[], backup: T[], key: (item: T) => unknown): RestorePlan<T>;
export function restoreMissingAll(current: Record<string, any[]>, backup: Record<string, any[]>, keys: Record<string, (item: any) => unknown>): Record<string, RestorePlan<any>>;
export function countWords(counts: Record<string, number | { add: unknown[] }>, names?: Record<string, [string, string]>): string;
