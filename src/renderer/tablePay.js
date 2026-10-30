/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
// "Pay the bill" button for menus published by a MenuAI server and opened from a table page
// (/t/<code> links to /m/<menu>#table=<code>). On the table tablet this is the way back to paying,
// even in kiosk mode without a Back button. Plain ES5, DOM APIs only (no HTML strings).
// The fragment never reaches the server; it is kept for this browser tab only and removed from the
// visible address, so a shared link does not carry the table's code.

var LABELS = { he: 'תשלום החשבון', en: 'Pay the bill', ar: 'دفع الحساب' };
var CODE_RE = /^[A-Za-z0-9_-]{22}$/;
var STORE_KEY = 'menuai:table';

/**
 * @param {Document} doc
 * @returns {HTMLAnchorElement | null} the button, or null when this page is not opened from a table
 */
export function initTablePay(doc) {
  var loc = doc.defaultView && doc.defaultView.location;
  if (!loc || !/^\/m\/[a-z0-9-]+\/?$/.test(loc.pathname)) return null;

  var match = /(?:^#|&)table=([A-Za-z0-9_-]{22})(?=&|$)/.exec(loc.hash);
  var code = match ? match[1] : null;
  try {
    var storage = doc.defaultView.sessionStorage;
    if (code) storage.setItem(STORE_KEY, code);
    else code = storage.getItem(STORE_KEY);
  } catch (e) {
    // Storage blocked (private mode): the button still works until the page is reloaded.
  }
  if (!code || !CODE_RE.test(code)) return null;
  if (match) {
    try {
      var url = new URL(loc.href);
      url.hash = '';
      doc.defaultView.history.replaceState(null, '', url.toString());
    } catch (e) { /* keep the address as is */ }
  }

  var link = doc.createElement('a');
  link.className = 'ma-pay';
  // The cart (tableOrder.js) reads the table code from here.
  link.setAttribute('data-ma-table', code);
  var icon = doc.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '💳';
  var text = doc.createElement('span');
  link.appendChild(icon);
  link.appendChild(text);

  function update() {
    var lang = (doc.documentElement.getAttribute('lang') || 'he').split('-')[0].toLowerCase();
    var label = LABELS[lang] || LABELS.en;
    text.textContent = label;
    link.setAttribute('href', '/t/' + code + '?lang=' + encodeURIComponent(lang));
    link.setAttribute('lang', LABELS[lang] ? lang : 'en');
    // Colors of the visible menu (its theme keeps accent/background contrast at WCAG AA).
    var root = doc.querySelector('[data-ma-lang-root]:not([hidden])') || doc.querySelector('[data-ma-lang-root]');
    if (root && doc.defaultView.getComputedStyle) {
      var css = doc.defaultView.getComputedStyle(root);
      var accent = css.getPropertyValue('--ma-accent').trim();
      var bg = css.getPropertyValue('--ma-bg').trim();
      if (accent && bg) {
        link.style.background = accent;
        link.style.color = bg;
      }
    }
  }

  update();
  doc.body.appendChild(link);
  // Room at the bottom so the button never hides the end of the menu (or its credit line).
  doc.body.classList.add('ma-has-pay');
  if (typeof MutationObserver === 'function') {
    new MutationObserver(update).observe(doc.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }
  return link;
}
