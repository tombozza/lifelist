// Settings › AI Updates: paste ChatGPT's block, preview, tick, Apply (sites/ai-updates).
// A module loaded after app.js; app.js exposes its own functions as window.lifeListApp,
// and ai/logic.js turns each action into calls to them. Nothing is written until Apply.

import { openUpdates } from '../vendor/ai-protocol/updates-sheet.js';
import schema from './schema.js';
import { buildContext, resolveItem, makeHandlers } from './logic.js';

const app = window.lifeListApp;
const handlers = makeHandlers(app);

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
  openUpdates({
    schema,
    context: () => buildContext(app.state, { today: app.env().today }),
    resolve: async item => resolveItem(item, app.state, app.env()),
    apply: async (item, choice) => {
      const handler = handlers[item.type];
      if (!handler) throw new Error(`“${item.type}” isn’t something Life List does`);
      return keepScroll(() => handler(item.action, choice));
    },
    done: () => keepScroll(() => app.render()),
  });
}

document.getElementById('settings-ai-updates')?.addEventListener('click', open);
