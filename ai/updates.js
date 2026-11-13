// AI Updates (sites/ai-updates): the ✨ AI button in the top bar, and Settings › AI Updates, open the
// shared AI page: paste ChatGPT's block, preview, tick, Apply.
// A module loaded after app.js; app.js exposes its own functions as window.lifeListApp,
// and ai/logic.js turns each action into calls to them. Nothing is written until Apply.

import '../vendor/magic/magic.js';   // <magic-mark> on Settings › AI Updates
import { openUpdates, mountAiButton } from '../vendor/ai-protocol/updates-sheet.js';
import { captureHubKey, shareContext } from '../vendor/ai-protocol/protocol.js';
import schema from './schema.js';
import { buildContext, resolveItem, makeHandlers } from './logic.js';

// The App Hub's set-up link (#ai-hub-key=…): take it before anything else.
captureHubKey();

const app = window.lifeListApp;
const handlers = makeHandlers(app);
const context = () => buildContext(app.state, { today: app.env().today });

// The daily copy (sites/ai-updates ARCHITECTURE §8b): share the board with the App Hub once the
// first cloud pull has merged, and again when the app comes back to the front. shareContext
// never throws and skips itself when there's no key or nothing changed.
app.firstSync().then(() => shareContext(schema, context));
document.addEventListener('visibilitychange', () => { if (!document.hidden) app.firstSync().then(() => shareContext(schema, context)); });

// Applying redraws the board; keep the page, the board's sideways scroll and each column
// where they were (sites rule: a click never moves the page).
function keepScroll(fn) {
  const y = window.scrollY;
  const board = document.getElementById('board-columns');
  const x = board ? board.scrollLeft : 0;
  const cols = [...document.querySelectorAll('.board-col')].map(c => [c.dataset.col, c.querySelector('.board-cards')?.scrollTop || 0]);
  try { return fn(); } finally {
    if (board) board.scrollLeft = x;
    cols.forEach(([col, top]) => { const el = document.querySelector(`.board-col[data-col="${col}"] .board-cards`); if (el) el.scrollTop = top; });
    if (window.scrollY !== y) window.scrollTo(0, y);
  }
}

function open() {
  app.closeSettings();   // the sheet isn't a <dialog>, so an open Settings sheet would sit on top of it
  return openUpdates({
    schema,
    context,
    resolve: async item => resolveItem(item, app.state, app.env()),
    apply: async (item, choice) => {
      const handler = handlers[item.type];
      if (!handler) throw new Error(`“${item.type}” isn’t something Life List does`);
      return keepScroll(() => handler(item.action, choice));
    },
    done: () => keepScroll(() => app.render()),
  });
}

// The ✨ AI button, the same in every app, before the sync dot. It counts parts of a reply pasted in
// another app that are waiting here, and recounts when the page closes.
const header = document.getElementById('app-header');
const ai = header ? mountAiButton(header, { app: schema.app, open }) : null;
if (ai) document.getElementById('sync-status')?.before(ai.button);

document.getElementById('settings-ai-updates')?.addEventListener('click', () => open().then(() => ai?.refresh()));
