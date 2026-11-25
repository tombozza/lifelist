/* COPY of sites/_shared/chassis/pattern.js — edit the source there and run node _shared/sync.mjs */
// ✏️ Draw-a-pattern, shared (came from Shoebox's ui/pattern.js; Tom, 17 Nov 2026: "can I have one of those things where you have to like draw a shape instead? I think
// they have them on like Android phones"). A 3×3 grid of dots, numbered 1–9 left to right, top to bottom: press on a dot and
// drag through others (mouse or touch). Passing over a dot you skipped picks it up, as on Android, so 1→3 is 1-2-3. The
// number keys draw too (1–9, ⌫ takes the last dot back, ↵ finishes). The server only ever sees the list of dots and keeps a
// hash of it. Used by Shoebox's lock and House Book's People lock. Classic script: it sets window.patternGrid / patternTwice.
//   patternGrid(host, { onDone(dots), size }) → { el, clear(), bad(), key(e), dots }
//   patternTwice(host, { onReady(dots | null), size }) — draw it, then again to confirm (setting a new one)
(function () {
  const CSS = `
.pgwrap{display:flex;flex-direction:column;align-items:center;gap:var(--sp-2,8px)}
.pgrid{display:block;width:100%;aspect-ratio:1;margin:0 auto;touch-action:none;user-select:none;-webkit-user-select:none;cursor:pointer;border-radius:var(--r-lg,16px);outline:none}
.pgrid:focus-visible{box-shadow:0 0 0 2px var(--accent,var(--acc))}
.pgrid .pgdot{fill:var(--text-3,var(--dim))}
.pgrid .pghalo{fill:var(--accent,var(--acc));opacity:0;transition:opacity var(--dur,200ms)}
.pgrid g.on .pgdot{fill:var(--accent,var(--acc))}
.pgrid g.on .pghalo{opacity:.2}
.pgrid .pgline,.pgrid .pglive{fill:none;stroke:var(--accent,var(--acc));stroke-width:7;stroke-linecap:round;stroke-linejoin:round;opacity:.7}
.pgrid .pglive{opacity:.35}
.pgrid.bad g.on .pgdot{fill:var(--danger,var(--bad2,var(--bad)))}
.pgrid.bad g.on .pghalo{fill:var(--danger,var(--bad2,var(--bad)))}
.pgrid.bad .pgline{stroke:var(--danger,var(--bad2,var(--bad)))}
.pgrid.bad{animation:pgshake .3s}
@keyframes pgshake{25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
@media (prefers-reduced-motion:reduce){.pgrid.bad{animation:none}}
.pgstep{font-size:var(--text-sm,13px);color:var(--text-3,var(--dim));min-height:1.4em;text-align:center}
.pgstep.ok{color:var(--success,var(--good))}.pgstep.bad{color:var(--danger,var(--bad2,var(--bad)))}`;
  function style() {
    if (document.getElementById('pgstyle')) return;
    const s = document.createElement('style'); s.id = 'pgstyle'; s.textContent = CSS; document.head.appendChild(s);
  }
  const XY = i => [50 + ((i - 1) % 3) * 100, 50 + Math.floor((i - 1) / 3) * 100];
  const between = (a, b) => {                       // the dot exactly half-way from a to b (1→3 is 2, 1→9 is 5), or 0
    const [ax, ay] = XY(a), [bx, by] = XY(b), mx = (ax + bx) / 2, my = (ay + by) / 2;
    return (mx - 50) % 100 === 0 && (my - 50) % 100 === 0 ? ((my - 50) / 100) * 3 + (mx - 50) / 100 + 1 : 0;
  };

  window.patternGrid = function (host, opt = {}) {
    style();
    const size = opt.size || 240;
    host.innerHTML = `<svg class="pgrid" style="max-width:${size}px" viewBox="0 0 300 300" tabindex="0" role="img"
      aria-label="Pattern: drag through the dots, or type the dot numbers 1 to 9 and press Enter"><polyline class="pgline"/><line class="pglive" visibility="hidden"/>
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => { const [x, y] = XY(i); return `<g data-d="${i}"><circle class="pghalo" cx="${x}" cy="${y}" r="27"/><circle class="pgdot" cx="${x}" cy="${y}" r="9"/></g>`; }).join('')}</svg>`;
    const svg = host.querySelector('svg'), line = svg.querySelector('.pgline'), live = svg.querySelector('.pglive');
    let dots = [], drawing = false, timer = 0;
    const paint = () => {
      line.setAttribute('points', dots.map(d => XY(d).join(',')).join(' '));
      svg.querySelectorAll('[data-d]').forEach(g => g.classList.toggle('on', dots.includes(+g.dataset.d)));
    };
    const add = d => {
      if (dots.includes(d)) return;
      const last = dots[dots.length - 1], mid = last ? between(last, d) : 0;
      if (mid && !dots.includes(mid)) dots.push(mid);
      dots.push(d); paint();
    };
    const at = e => { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left) * 300 / r.width, (e.clientY - r.top) * 300 / r.height]; };
    const hit = ([x, y]) => { for (let i = 1; i <= 9; i++) { const [cx, cy] = XY(i); if (Math.hypot(x - cx, y - cy) < 36) return i; } return 0; };
    function clear() { clearTimeout(timer); dots = []; svg.classList.remove('bad'); live.setAttribute('visibility', 'hidden'); paint(); }
    function bad() { svg.classList.remove('bad'); void svg.getBoundingClientRect(); svg.classList.add('bad'); clearTimeout(timer); timer = setTimeout(clear, 900); }
    const finish = () => { if (dots.length && opt.onDone) opt.onDone(dots.slice()); };
    const move = e => {
      if (!drawing) return;
      const p = at(e), d = hit(p); if (d) add(d);
      const l = dots[dots.length - 1]; if (!l) return;
      const [x, y] = XY(l);
      live.setAttribute('x1', x); live.setAttribute('y1', y); live.setAttribute('x2', p[0]); live.setAttribute('y2', p[1]); live.setAttribute('visibility', 'visible');
    };
    svg.addEventListener('pointerdown', e => { if (e.button > 0) return; e.preventDefault(); clear(); drawing = true; try { svg.setPointerCapture(e.pointerId); } catch (_) {} move(e); });
    svg.addEventListener('pointermove', move);
    const end = () => { if (!drawing) return; drawing = false; live.setAttribute('visibility', 'hidden'); finish(); };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    // keys: 1–9 add a dot, ⌫ takes the last back, ↵ finishes, esc clears (only while there's something to clear)
    function key(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      if (/^[1-9]$/.test(e.key)) { if (svg.classList.contains('bad')) clear(); add(+e.key); }
      else if (e.key === 'Backspace') { dots.pop(); paint(); }
      else if (e.key === 'Enter') finish();
      else if (e.key === 'Escape' && dots.length) clear();
      else return false;
      e.preventDefault(); e.stopPropagation(); return true;
    }
    svg.addEventListener('keydown', key);
    paint();
    return { el: svg, clear, bad, key, get dots() { return dots.slice(); } };
  };

  // a new pattern: draw it, then draw it again to confirm. onReady(dots) once both match, onReady(null) when it starts over.
  window.patternTwice = function (host, opt = {}) {
    style();
    host.innerHTML = '<div class="pgwrap"><div class="pgstep"></div><div class="pghost" style="width:100%"></div><button type="button" class="ui-btn small quiet" data-pgagain hidden>Start again</button></div>';
    const step = host.querySelector('.pgstep'), again = host.querySelector('[data-pgagain]');
    let first = null;
    const say = (t, c = '') => { step.textContent = t; step.className = 'pgstep' + (c ? ' ' + c : ''); };
    const g = window.patternGrid(host.querySelector('.pghost'), { size: opt.size, onDone: dots => {
      if (dots.length < 4) { say('Join at least 4 dots — try again', 'bad'); g.bad(); return; }
      if (!first) { first = dots; say('Now draw it again to confirm'); setTimeout(g.clear, 350); again.hidden = false; return; }
      if (first.join() === dots.join()) { say('✓ Pattern confirmed', 'ok'); opt.onReady && opt.onReady(dots); return; }
      first = null; say('The two didn’t match — draw a new one', 'bad'); g.bad(); again.hidden = true; opt.onReady && opt.onReady(null);
    } });
    again.onclick = () => { first = null; g.clear(); again.hidden = true; say('Draw a pattern through at least 4 dots'); opt.onReady && opt.onReady(null); };
    say('Draw a pattern through at least 4 dots');
    return g;
  };
})();
