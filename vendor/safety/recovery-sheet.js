/* COPY of sites/_shared/safety/recovery-sheet.js — edit the source there and run node _shared/sync.mjs */
// The recovery code sheet, the same in every app (Round 3). Shows a just-made recovery code once, with Copy,
// and doesn't close by tapping outside: only "I've saved it" closes it, so the code isn't lost by a stray tap.
//
//   import { showRecoveryCode, RECOVERY_HINT } from './vendor/safety/recovery-sheet.js';
//   const res = await put('/api/settings', { password_enabled: true, password });
//   if (res.recovery_code) await showRecoveryCode(res.recovery_code, { app: 'Golf Tracker' });
//
//   Under the lock screen's password box:  <p class="ui-hint">${RECOVERY_HINT}</p>
//   After a sign-in answered { recovered: true }: show RECOVERED_NOTE (e.g. a toast).

export const RECOVERY_HINT = 'Forgot it? Type your recovery code in the password box instead.';
export const RECOVERED_NOTE = 'Unlocked with your recovery code. Choose a new password in Settings: that also gives you a new code.';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name) => (typeof window !== 'undefined' && typeof window.uiIcon === 'function' ? window.uiIcon(name) : '');

/** Shows the code; resolves when the person says they've saved it. */
export function showRecoveryCode(code, { app = 'this app' } = {}) {
  const d = document.createElement('dialog');
  d.className = 'ui-sheet';
  d.innerHTML = `<header><h2>Your recovery code</h2></header>
    <div class="body">
      <p>If you ever forget the password for ${esc(app)}, type this code in the password box instead.</p>
      <p class="ui-title" data-code style="font-family:var(--font-mono, ui-monospace, monospace);user-select:all;overflow-wrap:anywhere">${esc(code)}</p>
      <p class="ui-note warn">Save it in your password manager now, next to the password. It's shown only this once.</p>
      <div class="ui-actions">
        <button type="button" class="ui-btn" data-copy>${icon('copy')}Copy</button>
        <button type="button" class="ui-btn primary" data-done>I've saved it</button>
      </div>
    </div>`;
  document.body.append(d);
  const opener = document.activeElement;
  d.addEventListener('cancel', (e) => e.preventDefault());   // Esc doesn't throw it away either
  d.querySelector('[data-copy]').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    try { await navigator.clipboard.writeText(code); b.innerHTML = `${icon('check')}Copied`; }
    catch { getSelection()?.selectAllChildren(d.querySelector('[data-code]')); b.textContent = 'Selected: copy it'; }
  });
  const done = new Promise((resolve) => {
    d.querySelector('[data-done]').addEventListener('click', () => {
      d.close(); d.remove();
      if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
      resolve();
    });
  });
  d.showModal();
  return done;
}
