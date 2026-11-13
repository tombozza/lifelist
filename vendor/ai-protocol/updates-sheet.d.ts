/* COPY of sites/_shared/ai-protocol/updates-sheet.d.ts — edit the source there and run node _shared/sync.mjs */
// Types for updates-sheet.js. Source: sites/_shared/ai-protocol/.
import type { AppSchema, Item, AppliedLog } from './protocol.js';

export interface Resolved { ok: boolean; text?: string; reason?: string; options?: { value: string; label: string }[] }
export interface ApplyResult { ok: boolean; item: Item; value?: unknown; error?: string }
export function openUpdates(o: {
  schema: AppSchema;
  context?: () => { data: unknown; note?: string };
  resolve?: (item: Item) => Promise<Resolved> | Resolved;
  /** Left out for an app that takes no changes: the page still sends other apps' parts on. */
  apply?: (item: Item, choice?: string) => Promise<unknown> | unknown;
  done?: (results: ApplyResult[]) => void;
  text?: string;
  /** false: don't share this app's state with the App Hub (the App Hub itself). */
  share?: boolean;
  /** Anything else to send the App Hub before the daily update is fetched (e.g. reference data). */
  beforeDaily?: () => Promise<unknown>;
  log?: AppliedLog;
}): Promise<(ApplyResult | null)[] | null>;
export function copyContext(schema: AppSchema, context: () => { data: unknown; note?: string }): Promise<void>;
/** The ✨ AI button for the top bar, with a count of parts waiting for this app. */
export function mountAiButton(container: Element, o: { app: string; open: () => unknown; label?: string }): { button: HTMLButtonElement; refresh: () => Promise<number> };
export interface WaitingItem { id: string; summary?: string; from: string; received_at: string; section: { v: number; actions: unknown[] } }
/** The top of the AI Updates page (Waiting, Reference, Daily, your paste card, App Hub line), for an app with its own page. */
export function aiHome(o: {
  schema: AppSchema;
  context?: () => { data: unknown; note?: string };
  share?: boolean;
  beforeDaily?: () => Promise<unknown>;
  /** Whether this app takes changes itself (default: not contextOnly). */
  takes?: boolean;
  /** Redraw the page: call html() again. */
  render?: () => void;
  onReview?: (item: WaitingItem) => unknown;
}): {
  html: (paste?: string) => string;
  pasteCard: (inner: string) => string;
  click: (b: Element | null) => Promise<boolean>;
  load: () => Promise<void>;
  drop: (id: string) => Promise<void>;
  state: { linked: boolean; loading: boolean; waiting: WaitingItem[]; flash: string; error: string; [k: string]: unknown };
};
