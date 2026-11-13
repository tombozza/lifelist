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
  /** Gives ChatGPT its state only; takes no actions (actions is {}). */
  contextOnly?: boolean;
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
export function contextBlock(o: { app: string; name: string; v: number; data: unknown; now?: Date; note?: string; contextOnly?: boolean }): string;

export const HUB_URL: string;
export function hubKey(store?: KVStore): string;
export function setHubKey(key: string, store?: KVStore): boolean;
/** A short message at the bottom of the page for a few seconds. */
export function showHubMessage(text: string, doc?: Document): void;
export function captureHubKey(loc?: Location, hist?: History, store?: KVStore): boolean;
export function lastShared(app: string, store?: KVStore): { at: number; ok: boolean; sig: string; status: number } | null;
export function shareContext(schema: AppSchema, context: () => { data: unknown; note?: string },
  opts?: { store?: KVStore; fetch?: typeof fetch; now?: () => number; force?: boolean; notify?: (text: string) => void }): Promise<{ shared: boolean; reason?: string }>;

// The shared page (ARCHITECTURE §8c)
export const CONTEXT_ONLY: Set<string>;
export interface InboxItem { id: string; summary: string; from: string; section: { v: number; actions: unknown[] }; received_at: string }
type HubOpts = { store?: KVStore; fetch?: typeof fetch };
export function hubCall(path: string, o?: HubOpts & { method?: string; body?: unknown }): Promise<any>;
export function fetchPack(part?: 'meta' | 'reference' | 'daily', o?: HubOpts): Promise<{ version: string; since?: string; apps?: string[]; text?: string }>;
export function fetchInbox(app: string, o?: HubOpts): Promise<InboxItem[]>;
export function clearInbox(app: string, id: string, o?: HubOpts): Promise<unknown>;
export function shareReference(app: string, ref: { title: string; text: string }, o?: HubOpts & { force?: boolean }): Promise<{ shared: boolean; reason?: string }>;
export function forwardParts(envelope: unknown, fromApp: string, o?: HubOpts): Promise<{ sent: string[]; failed: string[]; reason?: string }>;
export function inboxReply(app: string, item: InboxItem): string;
export function downloadText(name: string, text: string, doc?: Document): void;
export function referenceSeen(store?: KVStore): string;
export function markReferenceSeen(version: string, store?: KVStore): void;
