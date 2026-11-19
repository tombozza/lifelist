/* COPY of sites/_shared/safety/recovery.d.ts — edit the source there and run node _shared/sync.mjs */
export function makeRecoveryCode(): string;
export function normaliseRecoveryCode(s: unknown): string;
export function isRecoveryCode(s: unknown): boolean;
export function hashRecoveryCode(code: string): Promise<string>;
export function checkRecoveryCode(input: unknown, storedHash: string | null | undefined): Promise<boolean>;
