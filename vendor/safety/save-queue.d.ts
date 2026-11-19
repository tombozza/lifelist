/* COPY of sites/_shared/safety/save-queue.d.ts — edit the source there and run node _shared/sync.mjs */
export interface SaveQueueState { waiting: number; sending: boolean; failing: boolean; lastError: string }
export interface SaveQueue<Op = any> {
  push(op: Op & { key?: string | number }): void;
  flush(): Promise<void>;
  pending(): boolean;
  waiting(): Op[];
  state(): SaveQueueState;
  subscribe(f: (s: SaveQueueState) => void): () => void;
  stop(): void;
}
export function createSaveQueue<Op = any>(opts: {
  name: string;
  send: (op: Op) => Promise<unknown>;
  onChange?: (s: SaveQueueState) => void;
  onDrop?: (op: Op, err: unknown) => void;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}): SaveQueue<Op>;
export function saveStatus(queue: SaveQueue): HTMLElement;
