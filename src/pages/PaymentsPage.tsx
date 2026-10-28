/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api, isNoServer, type ApiUser } from '../api/client';
import {
  cancelBill, closeBill, createTable, formatAgorot, getSettings, listBills, listTables, openBill, paymentsStatus, rotateTable, saveSettings,
  shekelsToAgorot, updateBill, updateTable, type Bill, type DiningTable, type PaymentMode, type PaymentSettingsDto, type PaymentsStatus, type ProviderId,
} from '../api/payments';
import { useFeedback } from '../store/feedbackStore';
import { useT, type UiKey } from '../i18n/ui';

type Gate = { kind: 'loading' } | { kind: 'noServer' } | { kind: 'signedOut' } | { kind: 'staffOnly' } | { kind: 'ready'; me: ApiUser; status: PaymentsStatus };
type Section = 'bills' | 'tables' | 'settings';

/** Staff screens refresh bills on their own, so a waiter sees guests' payments come in. */
const REFRESH_MS = 10_000;

const ERRORS: Record<string, UiKey> = {
  bill_already_open: 'payErrBillOpen',
  amount_below_paid: 'payErrBelowPaid',
  bill_has_payments: 'payErrHasPayments',
  bill_not_open: 'payErrNotOpen',
  label_taken: 'payErrLabelTaken',
  credentials_required: 'payErrCredentials',
  invalid_credentials: 'payErrCredentials',
  provider_unavailable: 'payErrProvider',
  payments_not_configured: 'payNotConfigured',
};
const errorKey = (error: string, status: number): UiKey => ERRORS[error] ?? (status === 400 ? 'payErrInvalid' : status === 429 ? 'loginTooMany' : 'payErrFailed');

export function PaymentsPage() {
  const { t, dir } = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  const [gate, setGate] = useState<Gate>({ kind: 'loading' });
  const [section, setSection] = useState<Section>('bills');
  const sectionHeading = useRef<HTMLHeadingElement>(null);

  const refreshStatus = useCallback(async () => {
    const me = await api<{ user: ApiUser }>('/me');
    if (!me.ok) return setGate(me.status === 401 ? { kind: 'signedOut' } : isNoServer(me.status, me.error) ? { kind: 'noServer' } : { kind: 'signedOut' });
    if (me.data.user.role === 'viewer') return setGate({ kind: 'staffOnly' });
    const status = await paymentsStatus();
    if (!status.ok) return setGate(isNoServer(status.status, status.error) ? { kind: 'noServer' } : { kind: 'signedOut' });
    setGate({ kind: 'ready', me: me.data.user, status: status.data });
  }, []);

  useEffect(() => {
    heading.current?.focus();
    void refreshStatus();
  }, [refreshStatus]);

  const go = (s: Section) => {
    setSection(s);
    requestAnimationFrame(() => sectionHeading.current?.focus());
  };

  const isOwner = gate.kind === 'ready' && gate.me.role === 'owner';
  const sections: { id: Section; label: UiKey }[] = [
    { id: 'bills', label: 'payTabBills' },
    { id: 'tables', label: 'payTabTables' },
    ...(isOwner ? [{ id: 'settings' as const, label: 'payTabSettings' as const }] : []),
  ];

  return (
    <main className="doc-page team-page pay-page" id="main">
      <p><a href="#/"><span aria-hidden="true">{dir === 'rtl' ? '→' : '←'}</span> {t('backToEditor')}</a></p>
      <h1 ref={heading} tabIndex={-1}>{t('payTitle')}</h1>

      <div role="status" aria-live="polite">
        {gate.kind === 'loading' && <p className="hint">{t('cloudChecking')}</p>}
        {gate.kind === 'noServer' && <p className="notice notice-error">{t('cloudNoServer')}</p>}
        {gate.kind === 'staffOnly' && <p className="notice notice-error">{t('payStaffOnly')}</p>}
      </div>
      {gate.kind === 'signedOut' && (
        <>
          <p>{t('cloudSignedOut')}</p>
          <p><a className="btn btn-primary" href="#/login">{t('cloudSignIn')}</a></p>
        </>
      )}

      {gate.kind === 'ready' && (
        <>
          <p className="hint">{t('payIntro')}</p>
          {!gate.status.configured ? (
            <p className="notice notice-error">{t('payNotConfigured')}</p>
          ) : (
            <>
              {!gate.status.enabled && <p className="notice">{t(isOwner ? 'payOffOwner' : 'payOff')}</p>}
              {gate.status.enabled && gate.status.mode === 'test' && <p className="notice">🧪 {t('payTestNotice')}</p>}
              <nav className="pay-sections" aria-label={t('payTitle')}>
                {sections.map((s) => (
                  <button key={s.id} type="button" className={`btn btn-sm${section === s.id ? ' btn-primary' : ''}`} aria-pressed={section === s.id} onClick={() => go(s.id)}>
                    {t(s.label)}
                  </button>
                ))}
              </nav>
              <h2 ref={sectionHeading} tabIndex={-1}>{t(sections.find((s) => s.id === section)?.label ?? 'payTabBills')}</h2>
              {section === 'bills' && <BillsSection />}
              {section === 'tables' && <TablesSection isOwner={isOwner} />}
              {section === 'settings' && isOwner && <SettingsSection onSaved={() => void refreshStatus()} />}
            </>
          )}
        </>
      )}
    </main>
  );
}

// --- bills ------------------------------------------------------------------------------------------

function BillsSection() {
  const { t, lang } = useT();
  const id = useId();
  const notify = useFeedback((s) => s.notify);
  const confirm = useFeedback((s) => s.confirm);
  const [tables, setTables] = useState<DiningTable[] | null>(null);
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [view, setView] = useState<'open' | 'recent'>('open');
  const [failed, setFailed] = useState(false);
  const [form, setForm] = useState({ tableId: '', amount: '', note: '' });
  const [formError, setFormError] = useState<UiKey | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; amount: string } | null>(null);
  const money = (a: number) => formatAgorot(a, lang);

  const load = useCallback(async () => {
    const [tb, bl] = await Promise.all([listTables(), listBills(view)]);
    if (tb.ok) setTables(tb.data.tables.filter((x) => x.active));
    if (bl.ok) setBills(bl.data.bills);
    setFailed(!tb.ok || !bl.ok);
  }, [view]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const freeTables = tables?.filter((x) => !x.openBillId) ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const amountAgorot = shekelsToAgorot(form.amount);
    if (!form.tableId || amountAgorot === null || amountAgorot < 100) return setFormError('payErrAmount');
    setBusy('new');
    const r = await openBill({ tableId: form.tableId, amountAgorot, note: form.note.trim() });
    setBusy(null);
    if (!r.ok) return setFormError(errorKey(r.error, r.status));
    notify(t('payBillOpened'), 'success');
    setForm({ tableId: '', amount: '', note: '' });
    void load();
  };

  const act = async (bill: Bill, action: 'close' | 'cancel') => {
    const ok = await confirm(
      t(action === 'close' ? 'payCloseConfirm' : 'payCancelConfirm', { table: bill.tableLabel }),
      t(action === 'close' ? 'payCloseBill' : 'payCancelBill'),
    );
    if (!ok) return;
    setBusy(bill.id);
    const r = action === 'close' ? await closeBill(bill.id) : await cancelBill(bill.id);
    setBusy(null);
    if (!r.ok) return notify(t(errorKey(r.error, r.status)), 'error');
    notify(t(action === 'close' ? 'payBillClosed' : 'payBillCancelled'), 'success');
    void load();
  };

  const saveAmount = async (bill: Bill) => {
    if (!editing) return;
    const amountAgorot = shekelsToAgorot(editing.amount);
    if (amountAgorot === null || amountAgorot < 100) return notify(t('payErrAmount'), 'error');
    setBusy(bill.id);
    const r = await updateBill(bill.id, { amountAgorot });
    setBusy(null);
    if (!r.ok) return notify(t(errorKey(r.error, r.status)), 'error');
    setEditing(null);
    notify(t('payBillUpdated'), 'success');
    void load();
  };

  return (
    <>
      <section aria-labelledby={`${id}-new`} className="pay-card">
        <h3 id={`${id}-new`}>{t('payOpenBill')}</h3>
        {tables && tables.length === 0 ? (
          <p className="hint">{t('payNoTables')}</p>
        ) : (
          <form className="pay-form" onSubmit={(e) => void submit(e)} noValidate>
            <div className="field">
              <label htmlFor={`${id}-table`}>{t('payTable')}</label>
              <select id={`${id}-table`} value={form.tableId} onChange={(e) => setForm({ ...form, tableId: e.target.value })} required>
                <option value="">{t('payChooseTable')}</option>
                {freeTables.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${id}-amount`}>{t('payAmount')}</label>
              <input
                id={`${id}-amount`} type="text" inputMode="decimal" dir="ltr" autoComplete="off" required value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })} aria-invalid={formError === 'payErrAmount'}
                aria-describedby={formError ? `${id}-err` : undefined}
              />
            </div>
            <div className="field">
              <label htmlFor={`${id}-note`}>{t('payNote')}</label>
              <input id={`${id}-note`} type="text" maxLength={200} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy === 'new'} aria-busy={busy === 'new'}>{t('payOpen')}</button>
            {formError && <p className="error" id={`${id}-err`} role="alert">{t(formError)}</p>}
          </form>
        )}
      </section>

      <div className="pay-toolbar">
        <h3 id={`${id}-list`}>{t(view === 'open' ? 'payOpenBills' : 'payRecentBills')}</h3>
        <div className="button-row">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setView(view === 'open' ? 'recent' : 'open')}>
            {t(view === 'open' ? 'payShowRecent' : 'payShowOpen')}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>↻ {t('payRefresh')}</button>
        </div>
      </div>
      {failed && <p className="notice notice-error" role="alert">{t('cloudListFailed')}</p>}
      {bills === null && !failed && <p className="hint">{t('cloudLoading')}</p>}
      {bills?.length === 0 && <p className="hint">{t(view === 'open' ? 'payNoOpenBills' : 'payNoRecentBills')}</p>}
      <ul className="pay-bills" aria-labelledby={`${id}-list`}>
        {bills?.map((b) => {
          const pct = Math.min(100, Math.round((b.paidAgorot / b.amountAgorot) * 100));
          const left = Math.max(0, b.amountAgorot - b.paidAgorot);
          const isEditing = editing?.id === b.id;
          return (
            <li key={b.id} className="pay-card" aria-busy={busy === b.id}>
              <div className="pay-bill-head">
                <strong>{t('payTable')} {b.tableLabel}</strong>
                <span className={`team-badge${b.status === 'open' ? '' : ' is-off'}`}>{t(`payBill_${b.status}` as UiKey)}</span>
              </div>
              {b.note && <p className="hint" dir="auto">{b.note}</p>}
              {b.payments.some((p) => p.reviewReason) && <p className="notice notice-error" role="alert">⚠️ {t('payNeedsReview')}</p>}
              <dl className="pay-sums">
                <div><dt>{t('payBillTotal')}</dt><dd>{money(b.amountAgorot)}</dd></div>
                <div><dt>{t('payPaid')}</dt><dd>{money(b.paidAgorot)}</dd></div>
                {b.pendingAgorot > 0 && <div><dt>{t('payInProgress')}</dt><dd>{money(b.pendingAgorot)}</dd></div>}
                <div><dt>{t('payLeft')}</dt><dd>{money(left)}</dd></div>
                <div><dt>{t('payTipsTotal')}</dt><dd>{money(b.tipsAgorot)}</dd></div>
              </dl>
              <div className="pay-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('payPaidPercent', { pct })}>
                <span style={{ inlineSize: `${pct}%` }} />
              </div>
              {b.payments.length > 0 && (
                <details open={b.payments.some((p) => p.reviewReason)}>
                  <summary>{t('payPayments', { n: b.payments.length })}</summary>
                  <ul className="pay-payments">
                    {b.payments.map((p) => (
                      <li key={p.id}>
                        <span>{new Date(p.createdAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>{money(p.shareAgorot)}{p.tipAgorot > 0 && ` + ${t('payTip')} ${money(p.tipAgorot)}`}</span>
                        <span className={`team-badge${p.status === 'paid' ? '' : ' is-off'}`}>{t(`payPayment_${p.status}` as UiKey)}</span>
                        {p.mode === 'test' && <span className="hint">{t('payTestBadge')}</span>}
                        {p.transactionRef && <bdi className="hint" dir="ltr">{p.transactionRef}</bdi>}
                        {p.reviewReason && <strong className="pay-review">⚠️ {t(`payReview_${p.reviewReason}` as UiKey)}</strong>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {b.status === 'open' && (
                <div className="team-actions pay-actions">
                  {isEditing ? (
                    <>
                      <label className="visually-hidden" htmlFor={`${id}-e-${b.id}`}>{t('payAmount')}</label>
                      <input
                        id={`${id}-e-${b.id}`} type="text" inputMode="decimal" dir="ltr" className="pay-amount-input" value={editing.amount}
                        onChange={(e) => setEditing({ id: b.id, amount: e.target.value })} autoFocus
                      />
                      <button type="button" className="btn btn-sm btn-primary" disabled={busy === b.id} onClick={() => void saveAmount(b)}>{t('paySave')}</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>{t('close')}</button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-sm" onClick={() => setEditing({ id: b.id, amount: String(b.amountAgorot / 100) })}>{t('payEditAmount')}</button>
                  )}
                  <button type="button" className="btn btn-sm" disabled={busy === b.id} onClick={() => void act(b, 'close')}>{t('payCloseBill')}</button>
                  {b.paidAgorot === 0 && (
                    <button type="button" className="btn btn-sm btn-ghost btn-danger-text" disabled={busy === b.id} onClick={() => void act(b, 'cancel')}>{t('payCancelBill')}</button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// --- tables -----------------------------------------------------------------------------------------

function TablesSection({ isOwner }: { isOwner: boolean }) {
  const { t } = useT();
  const id = useId();
  const notify = useFeedback((s) => s.notify);
  const confirm = useFeedback((s) => s.confirm);
  const [tables, setTables] = useState<DiningTable[] | null>(null);
  const [menus, setMenus] = useState<{ id: string; title: string; slug: string }[]>([]);
  const [failed, setFailed] = useState(false);
  const [form, setForm] = useState({ label: '', menuId: '' });
  const [formError, setFormError] = useState<UiKey | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await listTables();
    if (r.ok) setTables(r.data.tables);
    setFailed(!r.ok);
  }, []);

  useEffect(() => {
    void load();
    void api<{ menus: { id: string; title: string; slug: string }[] }>('/menus').then((r) => {
      if (r.ok) setMenus(r.data.menus);
    });
  }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!form.label.trim()) return setFormError('payErrInvalid');
    setBusy('new');
    const r = await createTable({ label: form.label.trim(), menuId: form.menuId || null });
    setBusy(null);
    if (!r.ok) return setFormError(errorKey(r.error, r.status));
    notify(t('payTableAdded', { table: form.label.trim() }), 'success');
    setForm({ label: '', menuId: form.menuId });
    void load();
  };

  const patch = async (table: DiningTable, body: Partial<Pick<DiningTable, 'menuId' | 'active'>>) => {
    setBusy(table.id);
    const r = await updateTable(table.id, body);
    setBusy(null);
    if (!r.ok) notify(t(errorKey(r.error, r.status)), 'error');
    void load();
  };

  const rotate = async (table: DiningTable) => {
    if (!(await confirm(t('payRotateConfirm', { table: table.label }), t('payRotate')))) return;
    setBusy(table.id);
    const r = await rotateTable(table.id);
    setBusy(null);
    if (!r.ok) return notify(t(errorKey(r.error, r.status)), 'error');
    notify(t('payRotated', { table: table.label }), 'success');
    void load();
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      notify(t('cloudCopied'), 'success');
    } catch {
      notify(t('teamCopyManually'), 'info');
    }
  };

  const download = (table: DiningTable) => {
    const svg = document.getElementById(`${id}-qr-${table.id}`)?.querySelector('svg');
    if (!svg) return;
    const source = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
    const href = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
    const a = document.createElement('a');
    a.href = href;
    a.download = `table-${table.label.replace(/[^\p{L}\p{N}-]+/gu, '-')}-qr.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  return (
    <>
      {isOwner && (
        <section aria-labelledby={`${id}-new`} className="pay-card">
          <h3 id={`${id}-new`}>{t('payAddTable')}</h3>
          <form className="pay-form" onSubmit={(e) => void add(e)} noValidate>
            <div className="field">
              <label htmlFor={`${id}-label`}>{t('payTableLabel')}</label>
              <input id={`${id}-label`} type="text" maxLength={40} required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} aria-describedby={formError ? `${id}-err` : undefined} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-menu`}>{t('payTableMenu')}</label>
              <select id={`${id}-menu`} value={form.menuId} onChange={(e) => setForm({ ...form, menuId: e.target.value })}>
                <option value="">{t('payNoMenu')}</option>
                {menus.map((m) => <option key={m.id} value={m.id}>{m.title || m.slug}</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy === 'new'} aria-busy={busy === 'new'}>{t('payAdd')}</button>
            {formError && <p className="error" id={`${id}-err`} role="alert">{t(formError)}</p>}
          </form>
        </section>
      )}

      <p className="hint">{t('payTableQrHint')}</p>
      {failed && <p className="notice notice-error" role="alert">{t('cloudListFailed')}</p>}
      {tables === null && !failed && <p className="hint">{t('cloudLoading')}</p>}
      {tables?.length === 0 && <p className="hint">{t('payNoTablesYet')}</p>}
      <ul className="pay-tables">
        {tables?.map((x) => (
          <li key={x.id} className={`pay-card pay-table${x.active ? '' : ' is-disabled'}`} aria-busy={busy === x.id}>
            <div className="pay-bill-head">
              <strong>{t('payTable')} {x.label}</strong>
              {!x.active && <span className="team-badge is-off">{t('payInactive')}</span>}
              {x.openBillId && <span className="team-badge">{t('payHasOpenBill')}</span>}
            </div>
            {x.active && (
              <div className="pay-qr" id={`${id}-qr-${x.id}`}>
                <QRCodeSVG value={x.url} size={160} level="M" marginSize={2} bgColor="#ffffff" fgColor="#111111" title={t('payQrOf', { table: x.label })} />
              </div>
            )}
            <p className="team-link-url"><bdi dir="ltr">{x.url}</bdi></p>
            {isOwner && (
              <div className="field">
                <label htmlFor={`${id}-m-${x.id}`}>{t('payTableMenu')}</label>
                <select id={`${id}-m-${x.id}`} value={x.menuId ?? ''} disabled={busy === x.id} onChange={(e) => void patch(x, { menuId: e.target.value || null })}>
                  <option value="">{t('payNoMenu')}</option>
                  {menus.map((m) => <option key={m.id} value={m.id}>{m.title || m.slug}</option>)}
                </select>
              </div>
            )}
            <div className="team-actions pay-actions">
              {x.active && <button type="button" className="btn btn-sm" onClick={() => void copy(x.url)} aria-label={`${t('cloudCopyLink')}: ${x.label}`}>{t('cloudCopyLink')}</button>}
              {x.active && <button type="button" className="btn btn-sm" onClick={() => download(x)} aria-label={`${t('downloadQr')}: ${x.label}`}>{t('downloadQr')}</button>}
              {x.active && <a className="btn btn-sm btn-ghost" href={x.url} target="_blank" rel="noopener noreferrer">{t('payOpenGuestPage')}</a>}
              {isOwner && x.active && (
                <button type="button" className="btn btn-sm btn-ghost" disabled={busy === x.id} onClick={() => void rotate(x)} aria-label={`${t('payRotate')}: ${x.label}`}>{t('payRotate')}</button>
              )}
              {isOwner && (
                <button
                  type="button" className={`btn btn-sm${x.active ? ' btn-ghost btn-danger-text' : ''}`} disabled={busy === x.id}
                  onClick={() => void patch(x, { active: !x.active })} aria-label={`${t(x.active ? 'payDeactivate' : 'payActivate')}: ${x.label}`}
                >
                  {t(x.active ? 'payDeactivate' : 'payActivate')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

// --- settings (owner) -------------------------------------------------------------------------------

const PROVIDER_KEY: Record<ProviderId, UiKey> = { fake: 'payProvider_fake', grow: 'payProvider_grow' };

function SettingsSection({ onSaved }: { onSaved: () => void }) {
  const { t } = useT();
  const id = useId();
  const notify = useFeedback((s) => s.notify);
  const [loaded, setLoaded] = useState<{ settings: PaymentSettingsDto; providers: { id: ProviderId; credentialFields: string[] }[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [form, setForm] = useState({ enabled: false, provider: 'fake' as ProviderId, mode: 'test' as PaymentMode, tips: '' });
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [error, setError] = useState<UiKey | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await getSettings();
    if (!r.ok) return setFailed(true);
    setLoaded(r.data);
    const s = r.data.settings;
    const provider = r.data.providers.some((p) => p.id === s.provider) ? s.provider : (r.data.providers[0]?.id ?? s.provider);
    setForm({ enabled: s.enabled, provider, mode: s.mode, tips: s.tipPercents.join(', ') });
    setCreds({});
  }, []);

  useEffect(() => void load(), [load]);

  if (failed) return <p className="notice notice-error" role="alert">{t('cloudListFailed')}</p>;
  if (!loaded) return <p className="hint">{t('cloudLoading')}</p>;
  if (loaded.providers.length === 0) return <p className="notice">{t('payNoProviders')}</p>;

  const fields = loaded.providers.find((p) => p.id === form.provider)?.credentialFields ?? [];
  const sameProvider = loaded.settings.provider === form.provider;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parts = form.tips.split(/[,\s]+/).filter(Boolean);
    const tipPercents = parts.map(Number);
    if (parts.length > 5 || tipPercents.some((n) => !Number.isInteger(n) || n < 1 || n > 50)) return setError('payErrTips');
    const typed = Object.fromEntries(fields.map((f) => [f, (creds[f] ?? '').trim()]));
    const anyTyped = Object.values(typed).some(Boolean);
    if (anyTyped && Object.values(typed).some((v) => !v)) return setError('payErrCredentials');
    setSaving(true);
    const r = await saveSettings({
      enabled: form.enabled,
      provider: form.provider,
      mode: form.mode,
      tipPercents,
      ...(fields.length === 0 ? {} : anyTyped ? { credentials: typed } : {}),
    });
    setSaving(false);
    if (!r.ok) return setError(errorKey(r.error, r.status));
    notify(t('paySaved'), 'success');
    onSaved();
    void load();
  };

  return (
    <form className="pay-form pay-card" onSubmit={(e) => void submit(e)} noValidate>
      <div className="field field-check">
        <input id={`${id}-on`} type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
        <label htmlFor={`${id}-on`}>{t('payEnable')}</label>
      </div>
      <div className="field">
        <label htmlFor={`${id}-provider`}>{t('payProvider')}</label>
        <select id={`${id}-provider`} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as ProviderId, mode: 'test' })}>
          {loaded.providers.map((p) => <option key={p.id} value={p.id}>{t(PROVIDER_KEY[p.id])}</option>)}
        </select>
      </div>
      <fieldset className="field">
        <legend>{t('payMode')}</legend>
        {(['test', 'live'] as const).map((m) => (
          <label key={m} className="radio-row">
            <input type="radio" name={`${id}-mode`} value={m} checked={form.mode === m} disabled={m === 'live' && form.provider === 'fake'} onChange={() => setForm({ ...form, mode: m })} />
            {t(m === 'test' ? 'payModeTest' : 'payModeLive')}
          </label>
        ))}
        {form.mode === 'live' && <p className="notice" role="note">{t('payLiveWarning')}</p>}
      </fieldset>
      <div className="field">
        <label htmlFor={`${id}-tips`}>{t('payTipOptions')}</label>
        <input id={`${id}-tips`} type="text" inputMode="numeric" dir="ltr" value={form.tips} onChange={(e) => setForm({ ...form, tips: e.target.value })} aria-describedby={`${id}-tips-h`} />
        <p className="hint" id={`${id}-tips-h`}>{t('payTipsHint')}</p>
      </div>
      {fields.length > 0 && (
        <fieldset className="field">
          <legend>{t('payCredentials')}</legend>
          {sameProvider && loaded.settings.hasCredentials && <p className="hint">{t('payCredentialsSaved')}</p>}
          {fields.map((f) => (
            <div className="field" key={f}>
              <label htmlFor={`${id}-c-${f}`}>{t(`payCred_${f}` as UiKey)}</label>
              <input
                id={`${id}-c-${f}`} type="password" autoComplete="off" dir="ltr" spellCheck={false} maxLength={200}
                value={creds[f] ?? ''} onChange={(e) => setCreds({ ...creds, [f]: e.target.value })}
              />
            </div>
          ))}
          <p className="hint">{t('payCredentialsHint')}</p>
        </fieldset>
      )}
      <button type="submit" className="btn btn-primary" disabled={saving} aria-busy={saving}>{t('paySaveSettings')}</button>
      {error && <p className="error" role="alert">{t(error)}</p>}
    </form>
  );
}
