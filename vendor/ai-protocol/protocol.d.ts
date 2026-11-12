/* COPY of sites/_shared/ai-protocol/protocol.d.ts — edit the source there and run node _shared/sync.mjs */
// Types for protocol.js (for the TypeScript apps). Source: sites/_shared/ai-protocol/.

export interface ActionDef {
  title?: string;
  schema: Record<string, unknown>;
  describe?: (action: any) => string;
}
export interface AppSchema {
  app: string;
  name?: string;
  v: number;
  accepts: number[];
  defs?: Record<string, unknown>;
  actions: Record<string, ActionDef>;
  upgrade?: (fromV: number, actions: any[]) => any[];
}
export type ItemStatus = 'ready' | 'duplicate' | 'invalid' | 'unknown';
export interface Item {
  index: number;
  action: any;
  type: string;
  status: ItemStatus;
  errors: string[];
  fingerprint: string;
  title: string;
  text: string;
}
export type Processed =
  | { ok: false; error: string }
  | {
      ok: true; legacy: boolean; envelope: any; id: string | null; summary: string; stillOpen: string[];
      others: string[]; section: { v: number; actions: any[] } | null; note: string | null; items: Item[];
    };
export interface AppliedLog { has(fp: string): boolean; add(fps: string | string[]): void; clear(): void }
export interface KVStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export const PROTOCOL: 'ai-updates';
export const ENVELOPE_VERSION: number;
export const APP_NAMES: Record<string, string>;
export const ENVELOPE_SCHEMA: Record<string, unknown>;
export function findObjects(text: string): any[];
export function fromLegacy(obj: any): any;
export function extractEnvelope(text: string): { envelope: any; legacy: boolean } | { error: string };
export function canonical(v: unknown): string;
export function fingerprint(app: string, envelopeId: string | null | undefined, action: unknown): string;
export function appliedLog(app: string, store?: KVStore, now?: () => number): AppliedLog;
export function checkAppSchema(s: AppSchema): AppSchema;
export function processReply(text: string, schema: AppSchema, opts?: { log?: Pick<AppliedLog, 'has'> }): Processed;
export function contextBlock(o: { app: string; name: string; v: number; data: unknown; now?: Date; note?: string }): string;
