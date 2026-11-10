/* COPY of sites/_shared/chassis/theme.js — edit the source there and run node _shared/sync.mjs */
/* The shared light/dark switch for every app in sites/.

   Source: sites/_shared/chassis/theme.js. Tom, 11 Nov 2026: "add dark/light switches across all
   apps". Load it as a plain script in <head>, BEFORE the stylesheets and without defer or
   type="module", so the chosen theme is set before the page paints and nothing flashes:

     <script src="/vendor/chassis/theme.js"></script>

   It sets <html data-theme="light|dark"> from the person's choice, or leaves it off for Auto
   (follow the phone or computer). tokens.css already has the light and dark values for both
   cases, so an app needs no theme code of its own: its colours must come from tokens, and any
   dark colours of its own go in the same three places tokens.css uses (see README).

   Put the switch where settings live:
     <theme-switch></theme-switch>          Auto / Light / Dark, for a Settings screen
     <theme-switch compact></theme-switch>  one icon button that cycles, for a top bar
   From code: theme.get() → 'auto' | 'light' | 'dark', theme.set('dark'), and a
   'themechange' event on document with event.detail = { choice, dark }. */
(function () {
  var KEY = 'theme';
  var root = document.documentElement;
  var dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function read() {
    try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; }
    catch (e) { return 'auto'; }
  }
  function isDark(choice) { return choice === 'dark' || (choice === 'auto' && !!(dark && dark.matches)); }
  function apply(choice) {
    if (choice === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', choice);
    document.dispatchEvent(new CustomEvent('themechange', { detail: { choice: choice, dark: isDark(choice) } }));
  }
  function set(choice) {
    if (choice !== 'light' && choice !== 'dark') choice = 'auto';
    try { if (choice === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, choice); } catch (e) {}
    apply(choice);
  }

  apply(read());
  window.theme = { get: read, set: set, isDark: function () { return isDark(read()); } };
  // Another tab of the same app changed it; or the system flipped while on Auto.
  window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === null) apply(read()); });
  if (dark && dark.addEventListener) dark.addEventListener('change', function () { if (read() === 'auto') apply('auto'); });

  if (!window.customElements || customElements.get('theme-switch')) return;

  var ICON = {
    auto: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    dark: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.5 12.3A6.8 6.8 0 0 1 7.7 3.5a6.8 6.8 0 1 0 8.8 8.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  };
  var NAME = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  var ORDER = ['auto', 'light', 'dark'];

  customElements.define('theme-switch', class extends HTMLElement {
    connectedCallback() {
      this._sync = this.render.bind(this);
      document.addEventListener('themechange', this._sync);
      this.addEventListener('click', this.onClick);
      this.render();
    }
    disconnectedCallback() { document.removeEventListener('themechange', this._sync); }
    onClick(e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (this.hasAttribute('compact')) set(ORDER[(ORDER.indexOf(read()) + 1) % 3]);
      else set(b.dataset.theme);
    }
    render() {
      var now = read();
      if (this.hasAttribute('compact')) {
        this.innerHTML = '<button type="button" class="ui-btn quiet icon small" aria-label="Theme: ' + NAME[now] +
          '. Tap to change." title="Theme: ' + NAME[now] + '">' + ICON[now] + '</button>';
        return;
      }
      this.innerHTML = '<div class="ui-seg" role="group" aria-label="Theme">' + ORDER.map(function (t) {
        return '<button type="button" data-theme="' + t + '" aria-pressed="' + (t === now) + '">' +
          '<span style="display:inline-flex;align-items:center;gap:6px">' +
          ICON[t].replace('<svg ', '<svg width="16" height="16" ') + NAME[t] + '</span></button>';
      }).join('') + '</div>';
    }
  });
})();
