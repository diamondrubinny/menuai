/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
// Ordering from the menu (Phase 3e) on a server-published menu opened from a table page. It only
// appears when the server says ordering is on for this table. Prices shown here come from the server
// and are computed there again when the order is sent; nothing is charged by ordering: a waiter accepts
// the order into the table's bill. Plain ES5, DOM APIs only (no HTML strings).

var ORD_TEXT = {
  he: {
    add: 'הוספה', addNamed: 'הוספת {name} להזמנה', cart: 'ההזמנה שלי', cartCount: 'ההזמנה שלי, {n} פריטים', close: 'סגירה',
    empty: 'עוד לא נבחרו מנות.', note: 'הערה למטבח (לא חובה)', less: 'פחות', more: 'עוד', remove: 'הסרה', total: 'סה״כ',
    send: 'שליחת ההזמנה', sending: 'שולחים…', sent: 'ההזמנה נשלחה. מלצר יאשר אותה בקרוב.', noPay: 'אין חיוב עכשיו: ההזמנה מתווספת לחשבון אחרי אישור.',
    status_new: 'ממתינה לאישור', status_accepted: 'אושרה ונוספה לחשבון', status_rejected: 'לא אושרה', yours: 'ההזמנות האחרונות',
    err_unavailable_item: 'אחת המנות כבר לא זמינה. הסירו אותה ונסו שוב.', err_too_many_orders: 'יש כבר כמה הזמנות שממתינות למלצר. נסו שוב בעוד רגע.',
    err_ordering_unavailable: 'אי אפשר להזמין מהתפריט כרגע. אפשר להזמין דרך הצוות.', err_generic: 'ההזמנה לא נשלחה. נסו שוב.', noPersonal: 'בלי פרטים אישיים, בבקשה.',
  },
  en: {
    add: 'Add', addNamed: 'Add {name} to the order', cart: 'My order', cartCount: 'My order, {n} items', close: 'Close',
    empty: 'No dishes chosen yet.', note: 'Note for the kitchen (optional)', less: 'Less', more: 'More', remove: 'Remove', total: 'Total',
    send: 'Send the order', sending: 'Sending…', sent: 'Order sent. A waiter will confirm it shortly.', noPay: 'Nothing is charged now: the order joins the bill once accepted.',
    status_new: 'Waiting for the waiter', status_accepted: 'Accepted and added to the bill', status_rejected: 'Not accepted', yours: 'Your recent orders',
    err_unavailable_item: 'One of the dishes is no longer available. Remove it and try again.', err_too_many_orders: 'Several orders are already waiting for the waiter. Try again in a moment.',
    err_ordering_unavailable: 'Ordering from the menu is not available right now. Please order with the staff.', err_generic: 'The order was not sent. Please try again.', noPersonal: 'No personal details, please.',
  },
  ar: {
    add: 'إضافة', addNamed: 'إضافة {name} إلى الطلب', cart: 'طلبي', cartCount: 'طلبي، {n} أصناف', close: 'إغلاق',
    empty: 'لم يتم اختيار أي طبق بعد.', note: 'ملاحظة للمطبخ (اختياري)', less: 'أقل', more: 'أكثر', remove: 'إزالة', total: 'المجموع',
    send: 'إرسال الطلب', sending: 'جارٍ الإرسال…', sent: 'تم إرسال الطلب. سيؤكده النادل قريبًا.', noPay: 'لا يتم الدفع الآن: يُضاف الطلب إلى الحساب بعد قبوله.',
    status_new: 'بانتظار النادل', status_accepted: 'تم القبول والإضافة إلى الحساب', status_rejected: 'لم يُقبل', yours: 'طلباتك الأخيرة',
    err_unavailable_item: 'أحد الأطباق لم يعد متوفرًا. أزيلوه وحاولوا مجددًا.', err_too_many_orders: 'هناك عدة طلبات بانتظار النادل. حاولوا بعد قليل.',
    err_ordering_unavailable: 'الطلب من القائمة غير متاح حاليًا. يمكن الطلب عبر الطاقم.', err_generic: 'لم يُرسل الطلب. حاولوا مجددًا.', noPersonal: 'من دون تفاصيل شخصية من فضلكم.',
  },
};
var ORD_CART_KEY = 'menuai:cart';
var ORD_MAX_LINES = 30;
var ORD_MAX_QTY = 20;
var ORD_POLL_MS = 10000;

/**
 * @param {Document} doc
 * @param {string} code the table code (from the pay button)
 * @param {{ fetch?: typeof fetch }} [opts]
 * @returns {Promise<boolean>} whether ordering was set up
 */
export function initTableOrder(doc, code, opts) {
  var win = doc.defaultView;
  var http = (opts && opts.fetch) || (win && win.fetch && win.fetch.bind(win));
  if (!http || !/^[A-Za-z0-9_-]{22}$/.test(code)) return Promise.resolve(false);

  var items = {};
  var orders = [];
  var cart = loadCart();
  var lang = currentLang();
  var sending = false;
  var pollTimer = null;
  var lastFocus = null;
  var message = '';

  function currentLang() {
    var l = (doc.documentElement.getAttribute('lang') || 'he').split('-')[0].toLowerCase();
    return l;
  }
  function text(key, vars) {
    var dict = ORD_TEXT[lang] || ORD_TEXT.en;
    var s = dict[key] || ORD_TEXT.en[key] || key;
    if (vars) for (var k in vars) if (Object.prototype.hasOwnProperty.call(vars, k)) s = s.split('{' + k + '}').join(String(vars[k]));
    return s;
  }
  function money(agorot) {
    try {
      return new Intl.NumberFormat(lang, { style: 'currency', currency: 'ILS', minimumFractionDigits: agorot % 100 ? 2 : 0 }).format(agorot / 100);
    } catch (e) {
      return '₪' + (agorot / 100).toFixed(2);
    }
  }
  function loadCart() {
    try {
      var raw = win.sessionStorage.getItem(ORD_CART_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && parsed.code === code && Object.prototype.toString.call(parsed.lines) === '[object Array]') return parsed.lines.slice(0, ORD_MAX_LINES);
    } catch (e) { /* storage blocked or corrupt: start empty */ }
    return [];
  }
  function saveCart() {
    try { win.sessionStorage.setItem(ORD_CART_KEY, JSON.stringify({ code: code, lines: cart })); } catch (e) { /* ignore */ }
  }
  function newKey() {
    var bytes = new Uint8Array(16);
    if (win.crypto && win.crypto.getRandomValues) win.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    var out = '';
    for (var j = 0; j < bytes.length; j++) out += ('0' + bytes[j].toString(16)).slice(-2);
    return out;
  }
  function el(tag, cls, txt) {
    var node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (txt !== undefined) node.textContent = txt;
    return node;
  }
  function priceOf(line) {
    var item = items[line.itemId];
    if (!item) return null;
    if (item.variants) {
      for (var i = 0; i < item.variants.length; i++) if (item.variants[i].id === line.variantId) return item.variants[i].price;
      return null;
    }
    return line.variantId ? null : item.price;
  }
  function count() {
    var n = 0;
    for (var i = 0; i < cart.length; i++) n += cart[i].qty;
    return n;
  }

  // --- the cart button and dialog --------------------------------------------------------------------

  var cartButton = el('button', 'ma-cart');
  cartButton.type = 'button';
  cartButton.setAttribute('aria-haspopup', 'dialog');
  var cartIcon = el('span', '', '🛒');
  cartIcon.setAttribute('aria-hidden', 'true');
  var cartLabel = el('span');
  var cartBadge = el('span', 'ma-cart-count');
  cartBadge.setAttribute('aria-hidden', 'true');
  cartButton.appendChild(cartIcon);
  cartButton.appendChild(cartLabel);
  cartButton.appendChild(cartBadge);

  var overlay = el('div', 'ma-cart-overlay');
  overlay.hidden = true;
  var dialog = el('div', 'ma-cart-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.id = 'ma-cart-dialog';
  dialog.setAttribute('aria-labelledby', 'ma-cart-title');
  overlay.appendChild(dialog);
  cartButton.setAttribute('aria-controls', dialog.id);

  function open() {
    lastFocus = doc.activeElement;
    message = '';
    render();
    overlay.hidden = false;
    doc.body.classList.add('ma-cart-open');
    var title = doc.getElementById('ma-cart-title');
    if (title) title.focus();
  }
  function close() {
    overlay.hidden = true;
    doc.body.classList.remove('ma-cart-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    else cartButton.focus();
  }

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) close();
  });
  dialog.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    // Keep keyboard focus inside the dialog while it is open.
    var focusable = dialog.querySelectorAll('button:not([disabled]), input, [tabindex="-1"]');
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && doc.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && doc.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  cartButton.addEventListener('click', open);

  function updateButton() {
    var n = count();
    cartLabel.textContent = text('cart');
    cartBadge.textContent = n ? String(n) : '';
    cartButton.setAttribute('aria-label', n ? text('cartCount', { n: n }) : text('cart'));
    cartButton.hidden = n === 0 && orders.length === 0;
    cartButton.setAttribute('lang', ORD_TEXT[lang] ? lang : 'en');
  }

  function render() {
    while (dialog.firstChild) dialog.removeChild(dialog.firstChild);
    dialog.setAttribute('lang', ORD_TEXT[lang] ? lang : 'en');
    dialog.setAttribute('dir', lang === 'he' || lang === 'ar' ? 'rtl' : 'ltr');
    var head = el('div', 'ma-cart-head');
    var title = el('h2', '', text('cart'));
    title.id = 'ma-cart-title';
    title.tabIndex = -1;
    var x = el('button', 'ma-cart-x', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', text('close'));
    x.addEventListener('click', close);
    head.appendChild(title);
    head.appendChild(x);
    dialog.appendChild(head);

    if (cart.length === 0) dialog.appendChild(el('p', 'ma-cart-empty', text('empty')));
    var list = el('ul', 'ma-cart-lines');
    var total = 0;
    cart.forEach(function (line, index) {
      var item = items[line.itemId];
      var unit = priceOf(line);
      if (!item || unit === null) return;
      total += unit * line.qty;
      var li = el('li', 'ma-cart-line');
      var name = item.name;
      if (item.variants) {
        for (var i = 0; i < item.variants.length; i++) if (item.variants[i].id === line.variantId) name += ' · ' + item.variants[i].label;
      }
      var nameEl = el('span', 'ma-cart-name', name);
      li.appendChild(nameEl);
      var stepper = el('span', 'ma-cart-qty');
      var minus = el('button', '', '−');
      minus.type = 'button';
      minus.setAttribute('aria-label', text('less') + ': ' + name);
      var qty = el('output', '', String(line.qty));
      qty.setAttribute('aria-live', 'polite');
      var plus = el('button', '', '+');
      plus.type = 'button';
      plus.setAttribute('aria-label', text('more') + ': ' + name);
      plus.disabled = line.qty >= ORD_MAX_QTY;
      minus.addEventListener('click', function () {
        line.qty -= 1;
        if (line.qty <= 0) cart.splice(index, 1);
        changed(minus.getAttribute('aria-label'));
      });
      plus.addEventListener('click', function () {
        if (line.qty < ORD_MAX_QTY) line.qty += 1;
        changed(plus.getAttribute('aria-label'));
      });
      stepper.appendChild(minus);
      stepper.appendChild(qty);
      stepper.appendChild(plus);
      li.appendChild(stepper);
      li.appendChild(el('span', 'ma-cart-price', money(unit * line.qty)));
      var noteId = 'ma-cart-note-' + index;
      var noteLabel = el('label', 'ma-cart-note-label', text('note'));
      noteLabel.setAttribute('for', noteId);
      var note = el('input', 'ma-cart-note');
      note.id = noteId;
      note.type = 'text';
      note.maxLength = 140;
      note.value = line.note || '';
      note.setAttribute('placeholder', text('noPersonal'));
      note.addEventListener('input', function () {
        line.note = note.value.slice(0, 140);
        saveCart();
      });
      li.appendChild(noteLabel);
      li.appendChild(note);
      list.appendChild(li);
    });
    if (cart.length) dialog.appendChild(list);

    if (cart.length) {
      dialog.appendChild(el('p', 'ma-cart-total', text('total') + ': ' + money(total)));
      dialog.appendChild(el('p', 'ma-cart-hint', text('noPay')));
      var send = el('button', 'ma-cart-send', sending ? text('sending') : text('send'));
      send.type = 'button';
      send.disabled = sending;
      if (sending) send.setAttribute('aria-busy', 'true');
      send.addEventListener('click', submit);
      dialog.appendChild(send);
    }

    var status = el('p', 'ma-cart-status', message);
    status.setAttribute('role', 'status');
    dialog.appendChild(status);

    if (orders.length) {
      dialog.appendChild(el('h3', 'ma-cart-sub', text('yours')));
      var sent = el('ul', 'ma-cart-orders');
      orders.slice(0, 5).forEach(function (o) {
        var li = el('li', 'ma-cart-order ma-cart-order-' + o.status, money(o.totalAgorot) + ' · ' + text('status_' + o.status));
        if (o.status === 'rejected' && o.rejectReason) li.appendChild(el('span', 'ma-cart-reason', ' (' + o.rejectReason + ')'));
        sent.appendChild(li);
      });
      dialog.appendChild(sent);
    }
  }

  /** @param {string | null | false} [focusLabel] the control to focus again after re-rendering */
  function changed(focusLabel) {
    // Drop lines the menu no longer offers (sold out since they were added, or a different menu).
    cart = cart.filter(function (l) { return priceOf(l) !== null && l.qty > 0; });
    saveCart();
    updateButton();
    if (!overlay.hidden && focusLabel !== false) {
      render();
      // Put focus back on the same control (e.g. "More: Soup"), or the title when it is gone.
      var again = null;
      if (focusLabel) {
        var buttons = dialog.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) if (buttons[i].getAttribute('aria-label') === focusLabel && !buttons[i].disabled) again = buttons[i];
      }
      (again || doc.getElementById('ma-cart-title')).focus();
    }
  }

  function add(itemId, variantId) {
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].itemId === itemId && (cart[i].variantId || null) === (variantId || null)) {
        if (cart[i].qty < ORD_MAX_QTY) cart[i].qty += 1;
        changed(false);
        announceAdd();
        return;
      }
    }
    if (cart.length >= ORD_MAX_LINES) return;
    cart.push({ itemId: itemId, variantId: variantId || undefined, qty: 1, note: '' });
    changed(false);
    announceAdd();
  }

  // Screen readers hear that the dish was added (the button itself doesn't change).
  var live = el('p', 'ma-cart-live');
  live.setAttribute('role', 'status');
  function announceAdd() {
    live.textContent = '';
    win.setTimeout(function () { live.textContent = text('cartCount', { n: count() }); }, 50);
  }

  function submit() {
    if (sending || !cart.length) return;
    sending = true;
    message = '';
    render();
    var lines = cart.map(function (l) {
      var line = { itemId: l.itemId, qty: l.qty };
      if (l.variantId) line.variantId = l.variantId;
      if (l.note && l.note.trim()) line.note = l.note.trim().slice(0, 140);
      return line;
    });
    http('/t/' + code + '/order', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: newKey(), lang: lang, lines: lines }),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) { return { ok: res.ok, body: body }; });
      })
      .then(function (r) {
        sending = false;
        if (r.ok) {
          cart = [];
          saveCart();
          message = text('sent');
          refresh();
        } else {
          var err = r.body && r.body.error;
          message = ORD_TEXT.en['err_' + err] ? text('err_' + err) : text('err_generic');
        }
        updateButton();
        render();
        var title = doc.getElementById('ma-cart-title');
        if (title && !overlay.hidden) title.focus();
      })
      .catch(function () {
        sending = false;
        message = text('err_generic');
        render();
      });
  }

  // --- "Add" buttons on the dishes the server says can be ordered -----------------------------------

  function addButton(itemId, variantId, label) {
    var b = el('button', 'ma-add');
    b.type = 'button';
    var plus = el('span', '', '+');
    plus.setAttribute('aria-hidden', 'true');
    b.appendChild(plus);
    b.appendChild(el('span', '', ' ' + label.add));
    b.setAttribute('aria-label', label.named);
    b.setAttribute('data-ma-add', itemId + (variantId ? ':' + variantId : ''));
    b.addEventListener('click', function () { add(itemId, variantId); });
    return b;
  }

  function decorate() {
    var old = doc.querySelectorAll('.ma-add');
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
    var nodes = doc.querySelectorAll('[data-ma-item]');
    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      var itemId = node.getAttribute('data-ma-item');
      var item = items[itemId];
      if (!item) continue;
      // Labels in the language of that copy of the menu (every language is in the page).
      var root = node.closest ? node.closest('[data-ma-lang-root]') : null;
      var blockLang = ((root && root.getAttribute('data-ma-lang-root')) || lang).split('-')[0];
      var dict = ORD_TEXT[blockLang] || ORD_TEXT.en;
      var nameNode = node.querySelector('.ma-item-name');
      var shown = (nameNode && nameNode.textContent) || item.name;
      if (item.variants) {
        var rows = node.querySelectorAll('[data-ma-variant]');
        for (var k = 0; k < rows.length; k++) {
          var vid = rows[k].getAttribute('data-ma-variant');
          var labelNode = rows[k].querySelector('.ma-variant-label');
          var known = false;
          for (var v = 0; v < item.variants.length; v++) if (item.variants[v].id === vid) known = true;
          if (!known) continue;
          var full = shown + (labelNode && labelNode.textContent ? ' · ' + labelNode.textContent : '');
          rows[k].appendChild(addButton(itemId, vid, { add: dict.add, named: dict.addNamed.split('{name}').join(full) }));
        }
      } else {
        var body = node.querySelector('.ma-item-body') || node;
        body.appendChild(addButton(itemId, null, { add: dict.add, named: dict.addNamed.split('{name}').join(shown) }));
      }
    }
  }

  function apply(data) {
    items = data && data.items && typeof data.items === 'object' ? data.items : {};
    orders = data && Object.prototype.toString.call(data.orders) === '[object Array]' ? data.orders : [];
    var waiting = false;
    for (var i = 0; i < orders.length; i++) if (orders[i].status === 'new') waiting = true;
    if (pollTimer) win.clearTimeout(pollTimer);
    pollTimer = waiting ? win.setTimeout(refresh, ORD_POLL_MS) : null;
    changed(false);
    // A status update re-renders the open dialog, keeping the guest's focus where it was.
    if (!overlay.hidden) {
      var a = doc.activeElement;
      var id = a && dialog.contains(a) ? a.id : '';
      var label = a && dialog.contains(a) && a.getAttribute ? a.getAttribute('aria-label') : null;
      render();
      var again = id ? doc.getElementById(id) : null;
      if (!again && label) {
        var buttons = dialog.querySelectorAll('button');
        for (var j = 0; j < buttons.length; j++) if (buttons[j].getAttribute('aria-label') === label) again = buttons[j];
      }
      if (again) again.focus();
    }
  }

  function load() {
    return http('/t/' + code + '/order?lang=' + encodeURIComponent(lang), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; });
  }

  function refresh() {
    return load().then(function (data) {
      if (data && data.enabled) apply(data);
    });
  }

  return load().then(function (data) {
    if (!data || !data.enabled) return false;
    doc.body.appendChild(cartButton);
    doc.body.appendChild(overlay);
    doc.body.appendChild(live);
    doc.body.classList.add('ma-has-cart');
    apply(data);
    decorate();
    if (typeof MutationObserver === 'function') {
      new MutationObserver(function () {
        var next = currentLang();
        if (next === lang) return;
        lang = next;
        refresh();
      }).observe(doc.documentElement, { attributes: true, attributeFilter: ['lang'] });
    }
    return true;
  });
}
