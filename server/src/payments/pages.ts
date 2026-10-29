/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/**
 * Server-rendered guest pages for paying at the table. Plain HTML that works without JavaScript; a
 * small script (allowed by its hash in the CSP) only updates the totals live. Every dynamic value is
 * escaped. Targets WCAG 2.1 AA: labels, fieldsets, visible focus, live region for the total, RTL.
 */
import { createHash } from 'node:crypto';
import { BRAND } from '../../../src/core/brand';
import { formatShekels, MAX_SPLIT_PARTS } from './money';

export const GUEST_LOCALES = ['he', 'en', 'ar'] as const;
export type GuestLocale = (typeof GUEST_LOCALES)[number];
const RTL = new Set<GuestLocale>(['he', 'ar']);
const NUMBER_LOCALE: Record<GuestLocale, string> = { he: 'he-IL', en: 'en-IL', ar: 'ar-IL' };

// Arabic strings: reviewed by a native speaker before production (PRODUCTION_CHECKLIST.md).
const T = {
  he: {
    table: 'שולחן', menu: 'לתפריט', payTitle: 'תשלום החשבון', bill: 'סך החשבון', paid: 'שולם', remaining: 'נותר לתשלום',
    noBill: 'עדיין אין חשבון פתוח לשולחן הזה.', noBillHint: 'כשתרצו לשלם, בקשו מהמלצר לפתוח את החשבון ורעננו את העמוד.',
    refresh: 'רענון', unavailable: 'תשלום מהשולחן לא זמין כרגע. אפשר לשלם לצוות.',
    allPaid: 'החשבון שולם במלואו. תודה!',
    howMuch: 'כמה לשלם?', full: 'את כל היתרה', split: 'חלוקה שווה', splitBetween: 'מספר סועדים', each: 'לכל סועד',
    custom: 'סכום אחר', amount: 'סכום בשקלים',
    tip: 'טיפ לצוות', noTip: 'בלי טיפ', customTip: 'טיפ אחר', tipAmount: 'טיפ בשקלים',
    payer: 'פרטים לקבלה', payerHint: 'חברת הסליקה מבקשת שם וטלפון נייד כדי להפיק קבלה. אנחנו לא שומרים אותם.',
    fullName: 'שם מלא', phone: 'טלפון נייד',
    total: 'לתשלום', payNow: 'לתשלום מאובטח', secure: 'התשלום מתבצע בעמוד המאובטח של חברת הסליקה. פרטי הכרטיס לא עוברים דרכנו ולא נשמרים אצלנו.',
    testMode: 'מצב בדיקה: לא יחויב כסף אמיתי.',
    doneTitle: 'תודה! התשלום התקבל', doneText: 'שולם', back: 'חזרה לשולחן', receipt: 'לקבלה',
    pendingTitle: 'מאמתים את התשלום…', pendingText: 'זה לוקח בדרך כלל כמה שניות. העמוד יתעדכן לבד.',
    pendingLong: 'האימות לוקח יותר מהרגיל. אם חויבתם, הצוות יראה את התשלום ברגע שיאומת.',
    failedTitle: 'התשלום לא הושלם', failedText: 'לא חויבתם. אפשר לנסות שוב.', tryAgain: 'לנסות שוב',
    errors: {
      nothing_to_pay: 'אין יתרה לתשלום בחשבון הזה.', invalid_share: 'הסכום לא תקין. בדקו שהוא בין ₪1 ליתרה.',
      invalid_tip: 'הטיפ לא תקין.', invalid_payer: 'נא למלא שם מלא (שם פרטי ומשפחה) וטלפון נייד תקין.',
      provider_unavailable: 'חברת הסליקה לא זמינה כרגע. נסו שוב בעוד רגע.', bad_request: 'משהו בטופס לא תקין. נסו שוב.',
      terms_required: 'כדי לשלם צריך לאשר את תנאי התשלום.',
    },
    demoTitle: 'עמוד תשלום לדוגמה', demoText: 'זהו ספק ההדגמה של MenuAI. בעמוד אמיתי כאן יוזנו פרטי הכרטיס אצל חברת הסליקה.',
    approve: 'אישור התשלום', decline: 'דחיית התשלום',
    agree: 'קראתי ואני מאשר/ת את', terms: 'תנאי התשלום', newTab: '(נפתח בלשונית חדשה)',
    notFoundTitle: 'הקוד של השולחן לא פעיל', notFoundText: 'ייתכן שהקוד הוחלף. בקשו מהצוות קוד עדכני.',
  },
  en: {
    table: 'Table', menu: 'View menu', payTitle: 'Pay the bill', bill: 'Bill total', paid: 'Paid', remaining: 'Left to pay',
    noBill: 'There is no open bill for this table yet.', noBillHint: 'When you are ready to pay, ask your server to open the bill, then refresh this page.',
    refresh: 'Refresh', unavailable: 'Paying from the table is not available right now. You can pay the staff.',
    allPaid: 'The bill is fully paid. Thank you!',
    howMuch: 'How much would you like to pay?', full: 'The full balance', split: 'Split equally', splitBetween: 'Number of diners', each: 'each',
    custom: 'Another amount', amount: 'Amount in shekels',
    tip: 'Tip for the team', noTip: 'No tip', customTip: 'Other tip', tipAmount: 'Tip in shekels',
    payer: 'Receipt details', payerHint: 'The payment company needs a name and a mobile number to issue a receipt. We do not keep them.',
    fullName: 'Full name', phone: 'Mobile phone',
    total: 'Total', payNow: 'Pay securely', secure: 'You pay on the payment company’s secure page. Card details never pass through us and are not stored here.',
    testMode: 'Test mode: no real money will be charged.',
    doneTitle: 'Thank you! Payment received', doneText: 'Paid', back: 'Back to the table', receipt: 'View receipt',
    pendingTitle: 'Confirming your payment…', pendingText: 'This usually takes a few seconds. The page updates by itself.',
    pendingLong: 'Confirmation is taking longer than usual. If you were charged, the staff will see the payment as soon as it is confirmed.',
    failedTitle: 'The payment was not completed', failedText: 'You were not charged. You can try again.', tryAgain: 'Try again',
    errors: {
      nothing_to_pay: 'There is nothing left to pay on this bill.', invalid_share: 'That amount is not valid. It must be between ₪1 and the balance.',
      invalid_tip: 'That tip is not valid.', invalid_payer: 'Please enter your full name (first and last) and a valid mobile number.',
      provider_unavailable: 'The payment company is not available right now. Please try again in a moment.', bad_request: 'Something in the form is not valid. Please try again.',
      terms_required: 'Please accept the payment terms to pay.',
    },
    demoTitle: 'Demo payment page', demoText: 'This is MenuAI’s demo provider. On a real page, card details are entered here, at the payment company.',
    approve: 'Approve payment', decline: 'Decline payment',
    agree: 'I have read and accept the', terms: 'payment terms', newTab: '(opens in a new tab)',
    notFoundTitle: 'This table code is not active', notFoundText: 'The code may have been replaced. Please ask the staff for the current one.',
  },
  ar: {
    table: 'طاولة', menu: 'إلى القائمة', payTitle: 'دفع الحساب', bill: 'مجموع الحساب', paid: 'مدفوع', remaining: 'المتبقي للدفع',
    noBill: 'لا يوجد حساب مفتوح لهذه الطاولة بعد.', noBillHint: 'عندما تكونون جاهزين للدفع، اطلبوا من النادل فتح الحساب ثم حدّثوا الصفحة.',
    refresh: 'تحديث', unavailable: 'الدفع من الطاولة غير متاح حاليًا. يمكنكم الدفع للطاقم.',
    allPaid: 'تم دفع الحساب بالكامل. شكرًا!',
    howMuch: 'كم تريدون أن تدفعوا؟', full: 'كامل المبلغ المتبقي', split: 'تقسيم بالتساوي', splitBetween: 'عدد الأشخاص', each: 'لكل شخص',
    custom: 'مبلغ آخر', amount: 'المبلغ بالشيكل',
    tip: 'إكرامية للطاقم', noTip: 'بدون إكرامية', customTip: 'إكرامية أخرى', tipAmount: 'الإكرامية بالشيكل',
    payer: 'تفاصيل الإيصال', payerHint: 'تطلب شركة الدفع الاسم ورقم الهاتف المحمول لإصدار إيصال. نحن لا نحتفظ بهما.',
    fullName: 'الاسم الكامل', phone: 'الهاتف المحمول',
    total: 'للدفع', payNow: 'الدفع الآمن', secure: 'يتم الدفع في صفحة شركة الدفع الآمنة. تفاصيل البطاقة لا تمر عبرنا ولا تُحفظ لدينا.',
    testMode: 'وضع التجربة: لن يتم خصم أموال حقيقية.',
    doneTitle: 'شكرًا! تم استلام الدفع', doneText: 'مدفوع', back: 'العودة إلى الطاولة', receipt: 'عرض الإيصال',
    pendingTitle: 'جارٍ تأكيد الدفع…', pendingText: 'يستغرق ذلك عادةً بضع ثوانٍ. ستتحدّث الصفحة تلقائيًا.',
    pendingLong: 'يستغرق التأكيد وقتًا أطول من المعتاد. إذا تم الخصم، سيرى الطاقم الدفع فور تأكيده.',
    failedTitle: 'لم تكتمل عملية الدفع', failedText: 'لم يتم خصم أي مبلغ. يمكنكم المحاولة مرة أخرى.', tryAgain: 'المحاولة مرة أخرى',
    errors: {
      nothing_to_pay: 'لا يوجد مبلغ متبقٍ للدفع في هذا الحساب.', invalid_share: 'المبلغ غير صالح. يجب أن يكون بين ₪1 والمبلغ المتبقي.',
      invalid_tip: 'الإكرامية غير صالحة.', invalid_payer: 'يرجى إدخال الاسم الكامل (الاسم الأول واسم العائلة) ورقم هاتف محمول صالح.',
      provider_unavailable: 'شركة الدفع غير متاحة حاليًا. حاولوا مرة أخرى بعد قليل.', bad_request: 'هناك خطأ في النموذج. حاولوا مرة أخرى.',
      terms_required: 'يرجى الموافقة على شروط الدفع لإتمام الدفع.',
    },
    demoTitle: 'صفحة دفع تجريبية', demoText: 'هذا مزوّد العرض التجريبي من MenuAI. في الصفحة الحقيقية تُدخل تفاصيل البطاقة هنا لدى شركة الدفع.',
    approve: 'تأكيد الدفع', decline: 'رفض الدفع',
    agree: 'قرأت وأوافق على', terms: 'شروط الدفع', newTab: '(يفتح في علامة تبويب جديدة)',
    notFoundTitle: 'رمز الطاولة غير فعّال', notFoundText: 'ربما تم استبدال الرمز. اطلبوا من الطاقم الرمز الحالي.',
  },
} satisfies Record<GuestLocale, unknown>;

export type GuestErrorCode = keyof (typeof T)['he']['errors'];
export const t = (l: GuestLocale) => T[l];

export function pickLocale(requested: unknown, menuLocale: string | null, acceptLanguage: string | undefined): GuestLocale {
  const ok = (v: unknown): v is GuestLocale => typeof v === 'string' && (GUEST_LOCALES as readonly string[]).includes(v);
  if (ok(requested)) return requested;
  if (ok(menuLocale)) return menuLocale;
  const fromHeader = acceptLanguage?.split(',').map((p) => p.trim().slice(0, 2).toLowerCase()).find(ok);
  return fromHeader ?? 'he';
}

export function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const money = (agorot: number, l: GuestLocale) => esc(formatShekels(agorot, NUMBER_LOCALE[l]));

const STYLE = `
:root{--bg:#f6f1e8;--card:#fffdf8;--ink:#1d1a16;--muted:#5b5348;--line:#d9cfbf;--accent:#7a4f12;--accent-ink:#fff;--focus:#1a56db;--ok:#1e6b3a;--bad:#a1271c;--warn-bg:#fff4d6}
@media (prefers-color-scheme:dark){:root{--bg:#14110d;--card:#1f1a14;--ink:#f3ece0;--muted:#c4b8a6;--line:#3d342a;--accent:#e2b866;--accent-ink:#1a140c;--focus:#8ab4ff;--ok:#7fd49b;--bad:#ff9a8f;--warn-bg:#3a2e12}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.55 system-ui,-apple-system,"Segoe UI",Heebo,Arial,sans-serif}
main{max-width:34rem;margin:0 auto;padding:1.25rem 1rem 3rem}
h1{font-size:1.6rem;line-height:1.25;margin:.25rem 0 1rem}h2{font-size:1.1rem;margin:0 0 .5rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:1rem 1.1rem;margin:0 0 1rem}
.top{display:flex;justify-content:space-between;align-items:center;gap:.75rem;flex-wrap:wrap;margin-bottom:.5rem}
.muted{color:var(--muted)}.small{font-size:.9rem}
dl{display:grid;grid-template-columns:1fr auto;gap:.35rem 1rem;margin:0}dt{color:var(--muted)}dd{margin:0;font-weight:700;font-variant-numeric:tabular-nums}
fieldset{border:1px solid var(--line);border-radius:14px;padding:.75rem .9rem 1rem;margin:0 0 1rem;background:var(--card)}
legend{font-weight:700;padding:0 .35rem}
.opt{display:flex;align-items:center;gap:.6rem;min-height:48px;padding:.35rem .5rem;border-radius:10px}
.opt:has(input:checked){background:color-mix(in srgb,var(--accent) 12%,transparent)}
.opt input[type=radio]{width:22px;height:22px;accent-color:var(--accent);flex:none}
.opt .val{margin-inline-start:auto;font-weight:700;font-variant-numeric:tabular-nums}
.sub{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;padding:.25rem .5rem .5rem 2.4rem}
[dir=rtl] .sub{padding:.25rem 2.4rem .5rem .5rem}
/* The amount/diners fields appear only for the option they belong to (all shown where :has is unsupported). */
.opt:has(input:not(:checked))+.sub{display:none}
label.field{display:block;font-weight:600;margin:.6rem 0 .25rem}
input[type=text],input[type=tel],input[type=number],select{font:inherit;color:inherit;background:var(--bg);border:1.5px solid var(--line);border-radius:10px;min-height:48px;padding:.5rem .75rem;width:100%;max-width:100%}
.sub input,.sub select{width:auto;min-width:7rem}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;min-height:52px;padding:.75rem 1.25rem;border-radius:12px;border:0;font:inherit;font-weight:800;text-decoration:none;cursor:pointer;background:var(--accent);color:var(--accent-ink);width:100%}
.btn.secondary{background:transparent;color:var(--ink);border:1.5px solid var(--line);width:auto;min-height:44px;font-weight:700}
.btn+.btn{margin-top:.75rem}
a{color:inherit}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.total{display:flex;justify-content:space-between;align-items:baseline;font-size:1.25rem;font-weight:800;margin:.25rem 0 1rem}
.note{font-size:.92rem;color:var(--muted);margin:.75rem 0 0}
.banner{background:var(--warn-bg);border:1px solid var(--line);border-radius:12px;padding:.6rem .8rem;margin:0 0 1rem;font-weight:600}
.error{border:2px solid var(--bad);color:var(--bad);border-radius:12px;padding:.6rem .8rem;margin:0 0 1rem;font-weight:700}
.status{font-size:3rem;line-height:1;margin:.5rem 0}
.ok{color:var(--ok)}.bad{color:var(--bad)}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.opt input[type=checkbox]{width:22px;height:22px;accent-color:var(--accent);flex:none}
footer{text-align:center;color:var(--muted);font-size:.85rem;margin-top:2rem}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

/** Live totals (progressive enhancement). Mirrors the server's computeCharge, display only. */
export const PAY_SCRIPT = `(function(){
var f=document.getElementById('pay');if(!f)return;
var amount=+f.dataset.amount,remaining=+f.dataset.remaining,loc=f.dataset.locale;
var fmt=function(a){return new Intl.NumberFormat(loc,{style:'currency',currency:'ILS',minimumFractionDigits:a%100?2:0}).format(a/100)};
var val=function(n){var e=f.elements[n];return e?e.value:''};
var ag=function(v){var x=Math.round(parseFloat(String(v).replace(',','.'))*100);return isFinite(x)&&x>0?x:0};
function share(){var k=val('share');
 if(k==='split'){var p=+val('parts')||2;return Math.min(remaining,Math.ceil(amount/p))}
 if(k==='custom'){return Math.min(remaining,ag(val('shareAmount')))}
 return remaining}
function update(){var s=share(),k=val('tip'),tip=0;
 if(k==='custom')tip=ag(val('tipAmount'));else if(k&&k!=='none')tip=Math.round(s*(+k)/100);
 var each=document.getElementById('each');if(each)each.textContent=fmt(Math.min(remaining,Math.ceil(amount/(+val('parts')||2))));
 document.querySelectorAll('[data-tip]').forEach(function(el){el.textContent=fmt(Math.round(s*(+el.dataset.tip)/100))});
 document.getElementById('total').textContent=fmt(s+tip)}
f.addEventListener('input',update);f.addEventListener('change',update);update();
})();`;

export const PAY_SCRIPT_HASH = createHash('sha256').update(PAY_SCRIPT).digest('base64');

/** Strict CSP for guest pages. Forms may only go to us and, after the checkout redirect, to the provider. */
export function guestCsp(formOrigins: readonly string[]): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'sha256-${PAY_SCRIPT_HASH}'`,
    "img-src 'self' data:",
    "base-uri 'none'",
    `form-action 'self'${formOrigins.map((o) => ` ${o}`).join('')}`,
    "frame-ancestors 'none'",
  ].join('; ');
}

function layout(l: GuestLocale, title: string, body: string, opts: { refreshSeconds?: number; script?: boolean } = {}): string {
  return `<!doctype html>
<html lang="${l}" dir="${RTL.has(l) ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
${opts.refreshSeconds ? `<meta http-equiv="refresh" content="${opts.refreshSeconds}">` : ''}
<link rel="icon" href="data:,"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body><main>${body}
<footer>Powered by <a href="${esc(BRAND.repo)}" rel="noopener">${esc(BRAND.name)}</a> · Open source</footer></main>
${opts.script ? `<script>${PAY_SCRIPT}</script>` : ''}</body></html>`;
}

function langSwitch(l: GuestLocale, baseHref: string): string {
  const names: Record<GuestLocale, string> = { he: 'עברית', en: 'English', ar: 'العربية' };
  return `<nav aria-label="Language" class="small">${GUEST_LOCALES.filter((x) => x !== l)
    .map((x) => `<a href="${esc(baseHref)}?lang=${x}" lang="${x}" hreflang="${x}">${names[x]}</a>`)
    .join(' · ')}</nav>`;
}

export interface TablePageInput {
  locale: GuestLocale;
  tableLabel: string;
  restaurant: string | null;
  menuUrl: string | null;
  selfPath: string;
  state:
    | { kind: 'unavailable' }
    | { kind: 'no_bill' }
    | { kind: 'paid'; amount: number }
    | {
        kind: 'open';
        amount: number;
        paid: number;
        remaining: number;
        tipPercents: number[];
        requiresPayer: boolean;
        testMode: boolean;
        termsUrl: string | null;
        error?: GuestErrorCode;
        values?: Record<string, string>;
      };
}

export function tablePage(p: TablePageInput): string {
  const s = t(p.locale);
  const head = `<div class="top">${p.menuUrl ? `<a class="btn secondary" href="${esc(p.menuUrl)}">📖 ${esc(s.menu)}</a>` : '<span></span>'}${langSwitch(p.locale, p.selfPath)}</div>
<p class="muted" style="margin:0">${p.restaurant ? `${esc(p.restaurant)} · ` : ''}${esc(s.table)} ${esc(p.tableLabel)}</p>
<h1>${esc(s.payTitle)}</h1>`;
  const st = p.state;
  if (st.kind === 'unavailable') return layout(p.locale, s.payTitle, `${head}<div class="card"><p>${esc(s.unavailable)}</p></div>`);
  if (st.kind === 'no_bill') {
    return layout(p.locale, s.payTitle, `${head}<div class="card"><p><strong>${esc(s.noBill)}</strong></p><p class="muted">${esc(s.noBillHint)}</p>
<a class="btn secondary" href="${esc(p.selfPath)}?lang=${p.locale}">↻ ${esc(s.refresh)}</a></div>`);
  }
  if (st.kind === 'paid') {
    return layout(p.locale, s.payTitle, `${head}<div class="card"><p class="status ok" aria-hidden="true">✓</p><p><strong>${esc(s.allPaid)}</strong></p>
<dl><dt>${esc(s.bill)}</dt><dd>${money(st.amount, p.locale)}</dd></dl></div>`);
  }

  const v = st.values ?? {};
  const checked = (name: string, value: string, dflt: boolean) => ((v[name] ?? (dflt ? value : undefined)) === value ? ' checked' : '');
  const parts = Math.min(MAX_SPLIT_PARTS, Math.max(2, Math.trunc(Number(v.parts)) || 2));
  const partsOptions = Array.from({ length: MAX_SPLIT_PARTS - 1 }, (_, i) => i + 2)
        .map((n) => `<option value="${n}"${n === parts ? ' selected' : ''}>${n}</option>`)
    .join('');
  const each = Math.min(st.remaining, Math.ceil(st.amount / parts));
  const tips = st.tipPercents
    .map(
      (pct) => `<label class="opt"><input type="radio" name="tip" value="${pct}"${checked('tip', String(pct), false)}> ${pct}%
<span class="val" data-tip="${pct}">${money(Math.round((st.remaining * pct) / 100), p.locale)}</span></label>`,
    )
    .join('');
  const payer = st.requiresPayer
    ? `<fieldset><legend>${esc(s.payer)}</legend><p class="note" style="margin-top:0">${esc(s.payerHint)}</p>
<label class="field" for="fullName">${esc(s.fullName)}</label><input id="fullName" name="fullName" type="text" autocomplete="name" required maxlength="80" value="${esc(v.fullName ?? '')}">
<label class="field" for="phone">${esc(s.phone)}</label><input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="20" dir="ltr" value="${esc(v.phone ?? '')}"></fieldset>`
    : '';

  const body = `${head}
${st.testMode ? `<p class="banner" role="note">🧪 ${esc(s.testMode)}</p>` : ''}
${st.error ? `<p class="error" role="alert">${esc(s.errors[st.error])}</p>` : ''}
<div class="card"><dl><dt>${esc(s.bill)}</dt><dd>${money(st.amount, p.locale)}</dd>
${st.paid > 0 ? `<dt>${esc(s.paid)}</dt><dd>${money(st.paid, p.locale)}</dd>` : ''}
<dt>${esc(s.remaining)}</dt><dd>${money(st.remaining, p.locale)}</dd></dl></div>
<form id="pay" method="post" action="${esc(p.selfPath)}/pay" data-amount="${st.amount}" data-remaining="${st.remaining}" data-locale="${NUMBER_LOCALE[p.locale]}">
<input type="hidden" name="lang" value="${p.locale}">
<fieldset><legend>${esc(s.howMuch)}</legend>
<label class="opt"><input type="radio" name="share" value="full"${checked('share', 'full', true)}> ${esc(s.full)}<span class="val">${money(st.remaining, p.locale)}</span></label>
<label class="opt"><input type="radio" name="share" value="split"${checked('share', 'split', false)}> ${esc(s.split)}</label>
<div class="sub"><label for="parts">${esc(s.splitBetween)}</label><select id="parts" name="parts">${partsOptions}</select>
<span class="muted">${esc(s.each)}: <strong id="each">${money(each, p.locale)}</strong></span></div>
<label class="opt"><input type="radio" name="share" value="custom"${checked('share', 'custom', false)}> ${esc(s.custom)}</label>
<div class="sub"><label for="shareAmount">${esc(s.amount)}</label><input id="shareAmount" name="shareAmount" type="number" inputmode="decimal" min="1" step="0.01" dir="ltr" value="${esc(v.shareAmount ?? '')}"></div>
</fieldset>
<fieldset><legend>${esc(s.tip)}</legend>
<label class="opt"><input type="radio" name="tip" value="none"${checked('tip', 'none', true)}> ${esc(s.noTip)}</label>
${tips}
<label class="opt"><input type="radio" name="tip" value="custom"${checked('tip', 'custom', false)}> ${esc(s.customTip)}</label>
<div class="sub"><label for="tipAmount">${esc(s.tipAmount)}</label><input id="tipAmount" name="tipAmount" type="number" inputmode="decimal" min="0" step="0.01" dir="ltr" value="${esc(v.tipAmount ?? '')}"></div>
</fieldset>
${payer}
<p class="total"><span>${esc(s.total)}</span><span id="total" aria-live="polite">${money(st.remaining, p.locale)}</span></p>
${st.termsUrl ? `<p class="opt"><input type="checkbox" id="agree" name="agree" value="yes" required${v.agree === 'yes' ? ' checked' : ''}>
<label for="agree">${esc(s.agree)} <a href="${esc(st.termsUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.terms)}<span class="visually-hidden"> ${esc(s.newTab)}</span></a></label></p>` : ''}
<button class="btn" type="submit">🔒 ${esc(s.payNow)}</button>
<p class="note">${esc(s.secure)}</p>
</form>`;
  return layout(p.locale, s.payTitle, body, { script: true });
}

export function resultPage(
  l: GuestLocale,
  backHref: string,
  r: { kind: 'paid'; agorot: number; receiptUrl?: string | null } | { kind: 'pending'; long: boolean } | { kind: 'failed' },
): string {
  const s = t(l);
  if (r.kind === 'paid') {
    return layout(l, s.doneTitle, `<div class="card" role="status"><p class="status ok" aria-hidden="true">✓</p><h1>${esc(s.doneTitle)}</h1>
<dl><dt>${esc(s.doneText)}</dt><dd>${money(r.agorot, l)}</dd></dl></div>${
      // The provider's document link (https only, checked when it was stored); opens outside our page.
      r.receiptUrl ? `<a class="btn" href="${esc(r.receiptUrl)}" target="_blank" rel="noopener noreferrer">🧾 ${esc(s.receipt)}<span class="visually-hidden"> ${esc(s.newTab)}</span></a>` : ''
    }<a class="btn secondary" href="${esc(backHref)}">${esc(s.back)}</a>`);
  }
  if (r.kind === 'pending') {
    return layout(
      l,
      s.pendingTitle,
      `<div class="card" role="status"><p class="status" aria-hidden="true">⏳</p><h1>${esc(s.pendingTitle)}</h1><p>${esc(r.long ? s.pendingLong : s.pendingText)}</p></div>
<a class="btn secondary" href="${esc(backHref)}">${esc(s.back)}</a>`,
      { refreshSeconds: r.long ? 15 : 3 },
    );
  }
  return layout(l, s.failedTitle, `<div class="card" role="alert"><p class="status bad" aria-hidden="true">✕</p><h1>${esc(s.failedTitle)}</h1><p>${esc(s.failedText)}</p></div>
<a class="btn" href="${esc(backHref)}">${esc(s.tryAgain)}</a>`);
}

export function tableNotFoundPage(l: GuestLocale): string {
  const s = t(l);
  return layout(l, s.notFoundTitle, `<div class="card"><h1>${esc(s.notFoundTitle)}</h1><p>${esc(s.notFoundText)}</p></div>`);
}

export function demoProviderPage(l: GuestLocale, action: string, agorot: number): string {
  const s = t(l);
  return layout(l, s.demoTitle, `<p class="banner" role="note">🧪 ${esc(s.testMode)}</p><h1>${esc(s.demoTitle)}</h1>
<div class="card"><p>${esc(s.demoText)}</p><dl><dt>${esc(s.total)}</dt><dd>${money(agorot, l)}</dd></dl></div>
<form method="post" action="${esc(action)}"><input type="hidden" name="lang" value="${l}">
<p><button class="btn" name="outcome" value="paid" type="submit">✓ ${esc(s.approve)}</button></p>
<p><button class="btn secondary" name="outcome" value="declined" type="submit">✕ ${esc(s.decline)}</button></p></form>`);
}
