/* COPY of sites/_shared/safety/bin-kv.d.ts — edit the source there and run node _shared/sync.mjs */
import type { BinEntry } from './bin.js';
export function kvBinAdd(kv: KVNamespace, key: string, entry: { kind: string; label?: string; data: unknown }): Promise<string>;
export function kvBinList(kv: KVNamespace, key: string): Promise<Omit<BinEntry, 'data'>[]>;
export function kvBinTake<T = unknown>(kv: KVNamespace, key: string, id: string): Promise<BinEntry<T> | null>;
export function kvBinForget(kv: KVNamespace, key: string, id: string): Promise<{ ok: true }>;
