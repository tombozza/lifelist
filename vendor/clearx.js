/* Clear (×) button on every text/search input. Vendored; no dependencies.
   Clearing fires input + change so the page's own handlers (React included) see it. */
(function () {
  if (window.__clearX) return; window.__clearX = true;
  var SEL = 'input[type=text],input[type=search],input:not([type]),input[type=email],input[type=url],input[type=tel]';
  var css = '.clearx-wrap{position:relative;display:inline-flex;align-items:center;width:100%;min-width:0}' +
    '.clearx-wrap>input{width:100%;padding-right:34px !important}' +
    '.clearx-wrap>input::-webkit-search-cancel-button{-webkit-appearance:none;display:none}' +
    '.clearx-btn{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:24px;height:24px;border:0;border-radius:50%;' +
    'background:rgba(127,127,127,.25);color:inherit;font-size:16px;line-height:1;padding:0;cursor:pointer;display:none}' +
    '.clearx-wrap.has-text .clearx-btn{display:block}';
  function setNative(el, v) {
    var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d && d.set ? d.set.call(el, v) : (el.value = v);   // React tracks the native setter
  }
  function wrap(el) {
    if (el.dataset.clearx || el.inputMode === 'decimal' || el.inputMode === 'numeric' || el.readOnly || el.disabled || el.type === 'hidden' || el.closest('.clearx-wrap') || el.hasAttribute('data-no-clear')) return;
    el.dataset.clearx = '1';
    var box = document.createElement('span'); box.className = 'clearx-wrap';
    if (el.style.width) box.style.width = el.style.width;
    if (el.style.maxWidth) box.style.maxWidth = el.style.maxWidth;
    if (el.style.flex) box.style.flex = el.style.flex;
    var focused = document.activeElement === el, s0 = el.selectionStart, s1 = el.selectionEnd; el.parentNode.insertBefore(box, el); box.appendChild(el); if (focused) { el.focus(); try { el.setSelectionRange(s0, s1); } catch (e) {} }
    var x = document.createElement('button'); x.type = 'button'; x.className = 'clearx-btn'; x.tabIndex = -1;
    x.setAttribute('aria-label', 'Clear'); x.textContent = '×'; box.appendChild(x);
    var sync = function () { box.classList.toggle('has-text', !!el.value); };
    sync(); el.addEventListener('input', sync); el.addEventListener('change', sync);
    x.addEventListener('pointerdown', function (e) { e.preventDefault(); });
    x.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      setNative(el, ''); sync();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.focus();
    });
  }
  function scan(root) { if (root.querySelectorAll) root.querySelectorAll(SEL).forEach(wrap); }
  function start() {
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    scan(document);
    new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) {
      if (n.nodeType === 1) { if (n.matches && n.matches(SEL)) wrap(n); scan(n); } }); }); })
      .observe(document.body, { childList: true, subtree: true });
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
