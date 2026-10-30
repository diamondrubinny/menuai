/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initTableOrder } from '../src/renderer/tableOrder.js';

const CODE = 'AbCdEfGhIjKlMnOpQrStUv';
const MENU = `
<div data-ma-lang-root="he">
  <ul>
    <li data-ma-item="soup"><div class="ma-item-body"><h3 class="ma-item-name">מרק</h3></div></li>
    <li data-ma-item="wine"><div class="ma-item-body"><h3 class="ma-item-name">יין</h3>
      <ul><li class="ma-variant" data-ma-variant="glass"><span class="ma-variant-label">כוס</span></li>
          <li class="ma-variant" data-ma-variant="bottle"><span class="ma-variant-label">בקבוק</span></li></ul></div></li>
    <li data-ma-item="gone"><div class="ma-item-body"><h3 class="ma-item-name">נגמר</h3></div></li>
  </ul>
</div>`;

const ITEMS = {
  soup: { name: 'מרק', price: 4250 },
  wine: { name: 'יין', variants: [{ id: 'glass', label: 'כוס', price: 3800 }, { id: 'bottle', label: 'בקבוק', price: 16000 }] },
};

type Call = { url: string; init?: RequestInit };
function server(state: { enabled?: boolean; post?: { status: number; body: unknown }; orders?: unknown[] } = {}) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (init?.method === 'POST') {
      const p = state.post ?? { status: 201, body: { id: 'o1', totalAgorot: 8500 } };
      if (p.status < 300) state.orders = [{ id: 'o1', status: 'new', totalAgorot: 8500, rejectReason: null }];
      return json(p.body, p.status);
    }
    return json({ enabled: state.enabled ?? true, items: state.enabled === false ? {} : ITEMS, orders: state.orders ?? [] });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const cartButton = () => document.querySelector<HTMLButtonElement>('.ma-cart')!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;

describe('ordering from the menu (cart)', () => {
  beforeEach(() => {
    document.body.innerHTML = MENU;
    document.body.className = '';
    document.documentElement.lang = 'he';
    sessionStorage.clear();
  });

  it('does nothing when the server has ordering off', async () => {
    const s = server({ enabled: false });
    expect(await initTableOrder(document, CODE, { fetch: s.fetch })).toBe(false);
    expect(document.querySelector('.ma-cart, .ma-add')).toBeNull();
    expect(s.calls[0]!.url).toBe(`/t/${CODE}/order?lang=he`);
  });

  it('refuses a malformed table code without calling anything', async () => {
    const s = server();
    expect(await initTableOrder(document, 'nope', { fetch: s.fetch })).toBe(false);
    expect(s.calls).toHaveLength(0);
  });

  it('adds labelled "Add" buttons only to dishes the server offers, per size', async () => {
    const s = server();
    expect(await initTableOrder(document, CODE, { fetch: s.fetch })).toBe(true);
    const adds = [...document.querySelectorAll<HTMLButtonElement>('.ma-add')];
    expect(adds.map((b) => b.getAttribute('aria-label'))).toEqual(['הוספת מרק להזמנה', 'הוספת יין · כוס להזמנה', 'הוספת יין · בקבוק להזמנה']);
    expect(document.querySelector('[data-ma-item="gone"] .ma-add')).toBeNull();
    // Nothing chosen and nothing sent yet: the cart button stays out of the way.
    expect(cartButton().hidden).toBe(true);
  });

  it('builds the order, shows server prices, and sends only ids, sizes, quantities and notes', async () => {
    const s = server();
    await initTableOrder(document, CODE, { fetch: s.fetch });
    const add = (id: string) => document.querySelector<HTMLButtonElement>(`[data-ma-add="${id}"]`)!.click();
    add('soup');
    add('soup');
    add('wine:bottle');
    expect(cartButton().hidden).toBe(false);
    expect(cartButton().getAttribute('aria-label')).toBe('ההזמנה שלי, 3 פריטים');

    cartButton().click();
    expect(dialog().closest('.ma-cart-overlay')!.hasAttribute('hidden')).toBe(false);
    expect(document.activeElement?.id).toBe('ma-cart-title');
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(dialog().textContent).toContain('בקבוק');
    expect(dialog().querySelector('.ma-cart-total')!.textContent).toContain('245');

    const note = dialog().querySelector<HTMLInputElement>('.ma-cart-note')!;
    expect(document.querySelector(`label[for="${note.id}"]`)!.textContent).toBe('הערה למטבח (לא חובה)');
    note.value = 'בלי בצל';
    note.dispatchEvent(new Event('input'));
    dialog().querySelector<HTMLButtonElement>('.ma-cart-send')!.click();
    await flush();
    await flush();

    const post = s.calls.find((c) => c.init?.method === 'POST')!;
    expect(post.url).toBe(`/t/${CODE}/order`);
    const body = JSON.parse(String(post.init!.body));
    expect(body.key).toMatch(/^[0-9a-f]{32}$/);
    expect(body).toMatchObject({ lang: 'he', lines: [{ itemId: 'soup', qty: 2, note: 'בלי בצל' }, { itemId: 'wine', variantId: 'bottle', qty: 1 }] });
    expect(JSON.stringify(body)).not.toMatch(/price|total|Agorot/i);
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe('ההזמנה נשלחה. מלצר יאשר אותה בקרוב.');
    expect(dialog().textContent).toContain('ממתינה לאישור');
    expect(sessionStorage.getItem('menuai:cart')).toContain('"lines":[]');
  });

  it('explains a refused order and keeps the cart', async () => {
    const s = server({ post: { status: 409, body: { error: 'unavailable_item' } } });
    await initTableOrder(document, CODE, { fetch: s.fetch });
    document.querySelector<HTMLButtonElement>('[data-ma-add="soup"]')!.click();
    cartButton().click();
    dialog().querySelector<HTMLButtonElement>('.ma-cart-send')!.click();
    await flush();
    await flush();
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe('אחת המנות כבר לא זמינה. הסירו אותה ונסו שוב.');
    expect(dialog().querySelectorAll('.ma-cart-line')).toHaveLength(1);
  });

  it('changes quantities with named buttons, closes on Escape and returns focus', async () => {
    const s = server();
    await initTableOrder(document, CODE, { fetch: s.fetch });
    document.querySelector<HTMLButtonElement>('[data-ma-add="soup"]')!.click();
    cartButton().focus();
    cartButton().click();
    const more = dialog().querySelector<HTMLButtonElement>('button[aria-label="עוד: מרק"]')!;
    more.click();
    expect(dialog().querySelector('output')!.textContent).toBe('2');
    // Focus stays on the same control after the list re-renders.
    expect(document.activeElement?.getAttribute('aria-label')).toBe('עוד: מרק');
    dialog().querySelector<HTMLButtonElement>('button[aria-label="פחות: מרק"]')!.click();
    dialog().querySelector<HTMLButtonElement>('button[aria-label="פחות: מרק"]')!.click();
    expect(dialog().querySelector('.ma-cart-line')).toBeNull();
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.ma-cart-overlay')!.hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(cartButton());
  });

  it('keeps the cart for this table only (browser tab storage)', async () => {
    sessionStorage.setItem('menuai:cart', JSON.stringify({ code: 'ZZZZZZZZZZZZZZZZZZZZZZ', lines: [{ itemId: 'soup', qty: 3 }] }));
    await initTableOrder(document, CODE, { fetch: server().fetch });
    expect(cartButton().hidden).toBe(true);
    sessionStorage.setItem('menuai:cart', JSON.stringify({ code: CODE, lines: [{ itemId: 'soup', qty: 2 }, { itemId: 'gone', qty: 1 }] }));
    document.body.innerHTML = MENU;
    await initTableOrder(document, CODE, { fetch: server().fetch });
    // A dish the menu no longer offers is dropped.
    expect(cartButton().getAttribute('aria-label')).toBe('ההזמנה שלי, 2 פריטים');
  });
});
