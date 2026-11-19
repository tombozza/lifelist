/* COPY of sites/_shared/safety/recovery-sheet.d.ts — edit the source there and run node _shared/sync.mjs */
export const RECOVERY_HINT: string;
export const RECOVERED_NOTE: string;
export function showRecoveryCode(code: string, opts?: { app?: string; lock?: string; how?: string }): Promise<void>;
