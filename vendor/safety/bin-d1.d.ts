/* COPY of sites/_shared/safety/bin-d1.d.ts — edit the source there and run node _shared/sync.mjs */
type Row = Record<string, unknown>;
export interface BinListEntry { id: string; kind: string; label: string; deleted_at: string }
export function binAdd(db: D1Database, table: string, entry: { kind: string; label?: string; rows: Record<string, Row[]> }): Promise<string>;
export function binList(db: D1Database, table: string): Promise<BinListEntry[]>;
export function binRestore(db: D1Database, table: string, id: string): Promise<{ ok: true; restored: number } | { error: string }>;
export function binForget(db: D1Database, table: string, id: string): Promise<{ ok: true }>;
export function rowsOf(db: D1Database, table: string, where: string, binds?: unknown[]): Promise<Row[]>;
