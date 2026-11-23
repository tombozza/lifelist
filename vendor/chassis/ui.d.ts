/* COPY of sites/_shared/chassis/ui.d.ts — edit the source there and run node _shared/sync.mjs */
// Types for the chassis's plain scripts (ui.js, when.js, fuzzy.js, picker.js), for the TypeScript apps.
// Import the scripts once for their side effect (import './vendor/chassis/ui.js'), then use the globals.
type DateLike = string | number | Date;
interface UiToastOptions { bad?: boolean; undo?: () => void; action?: { label: string; fn: () => void }; ms?: number }
interface UiAskButton<V = unknown> { label: string; value: V | null; primary?: boolean; danger?: boolean; sub?: string }
interface UiAskOptions<V = unknown> {
  title: string; body?: string; buttons?: UiAskButton<V>[];
  input?: { label?: string; value?: string; inputmode?: string };
  type?: string;
}
interface UiPickItem { id: string | number; name: string; group?: string; sub?: string; keywords?: string }
type MaybeAsync<T> = T | Promise<T>;
interface UiManageItem { id: string | number; name: string; sub?: string; fixed?: boolean; noRename?: boolean; fixedWhy?: string }
interface UiManageGroup { id: string | number; name: string; items: UiManageItem[]; fixed?: boolean; fixedWhy?: string; noAdd?: boolean; noRename?: boolean; empty?: string }
interface UiManageOptions {
  noun?: string; nouns?: string; groupNoun?: string; groupNouns?: string;
  groups?: UiManageGroup[] | (() => UiManageGroup[]);
  items?: UiManageItem[] | (() => UiManageItem[]);
  order?: boolean; groupOrder?: boolean; select?: boolean; permanent?: boolean; duplicates?: boolean; empty?: string;
  add?: (name: string, groupId?: string | number) => MaybeAsync<unknown>;
  addGroup?: (name: string) => MaybeAsync<string | number>;
  rename?: (item: UiManageItem, name: string) => MaybeAsync<unknown>;
  renameGroup?: (group: UiManageGroup, name: string) => MaybeAsync<unknown>;
  move?: (ids: string[], toGroupId: string | number, index: number) => MaybeAsync<unknown>;
  moveGroup?: (groupId: string | number, index: number) => MaybeAsync<unknown>;
  remove?: (items: UiManageItem[]) => MaybeAsync<(() => MaybeAsync<unknown>) | void>;
  loose?: { label?: string; sub?: string };
  removeGroup?: (group: UiManageGroup, o: { moveTo: string | number | null; loose?: boolean }) => MaybeAsync<(() => MaybeAsync<unknown>) | void>;
  open?: (item: UiManageItem) => void;
  actions?: { label: string; icon?: string; sub?: string; when?: (item: UiManageItem) => boolean; fn: (items: UiManageItem[]) => MaybeAsync<unknown> }[];
}

declare global {
  function uiToast(msg: string, o?: UiToastOptions): HTMLElement;
  function uiAsk<V = unknown>(o: UiAskOptions<V>): Promise<V | string | null>;
  function uiConfirm(o?: { title?: string; body?: string; ok?: string; cancel?: string; danger?: boolean; type?: string }): Promise<boolean>;
  function uiBusy<T>(button: HTMLElement | null, job: () => Promise<T> | T, o?: { doing?: string; done?: string }): Promise<T | undefined>;
  function uiCopy(text: string, o?: { button?: HTMLElement; done?: string; toast?: boolean }): Promise<boolean>;
  function uiShare(o: { title?: string; text?: string; url?: string; files?: File[] }): Promise<'shared' | 'downloaded' | 'copied' | null>;
  function uiDownload(name: string, data: unknown, type?: string): void;
  function uiPick(o: {
    title?: string; label?: string; items: UiPickItem[]; current?: string | number | null; extras?: UiPickItem[];
    add?: (name: string, stepId?: string | number) => Promise<string | number>; addHint?: string; back?: boolean;
    step?: { title?: string | ((name: string) => string); label?: string; items: UiPickItem[] | (() => Promise<UiPickItem[]>);
             add?: (name: string) => Promise<string | number>; addHint?: string };
  }): Promise<{ id: string | number; item: UiPickItem; added: boolean } | null>;
  const uiManage: {
    (el: HTMLElement, o: UiManageOptions): { refresh(): void; select(on?: boolean): void; destroy(): void };
    sheet(o: UiManageOptions & { title?: string; onClose?: () => void }): Promise<void>;
  };
  const uiDate: {
    parse(x: DateLike | null | undefined): Date | null;
    daysFrom(x: DateLike, now?: DateLike): number | null;
    day(x: DateLike, o?: { weekday?: boolean; year?: boolean }, now?: DateLike): string;
    long(x: DateLike): string;
    range(a: DateLike, b?: DateLike | null, now?: DateLike): string;
    label(x: DateLike, now?: DateLike): string;
    rel(x: DateLike, now?: DateLike): string;
    ago(x: DateLike, now?: DateLike): string;
    when(x: DateLike, now?: DateLike): string;
    time(x: DateLike): string;
    today(now?: DateLike): string;
    addDays(x: DateLike, n: number): string;
    iso(x: DateLike): string;
  };
  interface UiHelpGuide {
    id: string; group?: string; title: string; words?: string; where?: string; steps?: string[];
    done?: string; tip?: string; go?: unknown; related?: string[]; isNew?: boolean;
  }
  interface UiHelpAnswer {
    answer?: string | null; found?: string | null; cant?: string | null; guide?: string | null;
    act?: { label: string; run(): unknown; items?: string[]; heading?: string } | null;
  }
  const uiHelp: {
    open(o: { title?: string; groups?: { id: string; name: string }[]; guides: UiHelpGuide[]; start?: string; query?: string;
              go?: (guide: UiHelpGuide) => void; ask?: { icon?: string; run(question: string): Promise<UiHelpAnswer | null> } }): Promise<void>;
    search(guides: UiHelpGuide[], query: string): UiHelpGuide[];
  };
  const uiFuzzy: {
    match(query: string, ...texts: unknown[]): boolean;
    plain(query: string, ...texts: unknown[]): boolean;
    find<T>(items: T[], query: string, textsOf?: (x: T) => unknown[]): T[];
    distance(a: string, b: string, max?: number): number;
    norm(s: unknown): string;
  };
  interface Window { uiDate: typeof uiDate; uiFuzzy: typeof uiFuzzy }
}
export {};
