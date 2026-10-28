/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/** Pay at the table: staff side. Roles are enforced by the server on every call. */
import { api } from './client';

export type ProviderId = 'fake' | 'grow';
export type PaymentMode = 'test' | 'live';

export interface PaymentsStatus {
  configured: boolean;
  providers: ProviderId[];
  enabled: boolean;
  provider: ProviderId | null;
  mode: PaymentMode | null;
}

export interface PaymentSettingsDto {
  enabled: boolean;
  provider: ProviderId;
  mode: PaymentMode;
  tipPercents: number[];
  hasCredentials: boolean;
  updatedAt: string | null;
}

export interface DiningTable {
  id: string;
  label: string;
  menuId: string | null;
  active: boolean;
  url: string;
  openBillId: string | null;
}

export interface BillPayment {
  id: string;
  shareAgorot: number;
  tipAgorot: number;
  status: 'pending' | 'paid' | 'failed' | 'expired';
  /** Money arrived that the bill could no longer take: staff must refund or review it. */
  reviewReason: 'bill_not_open' | 'overpaid' | null;
  provider: ProviderId;
  mode: PaymentMode;
  transactionRef: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface Bill {
  id: string;
  tableId: string;
  tableLabel: string;
  amountAgorot: number;
  paidAgorot: number;
  pendingAgorot: number;
  tipsAgorot: number;
  note: string;
  status: 'open' | 'paid' | 'closed' | 'cancelled';
  openedAt: string;
  closedAt: string | null;
  payments: BillPayment[];
}

export const paymentsStatus = () => api<PaymentsStatus>('/payments/status');
export const getSettings = () =>
  api<{ settings: PaymentSettingsDto; providers: { id: ProviderId; credentialFields: string[] }[] }>('/payments/settings');
export const saveSettings = (body: { enabled: boolean; provider: ProviderId; mode: PaymentMode; tipPercents: number[]; credentials?: Record<string, string> | null }) =>
  api<{ ok: true }>('/payments/settings', { method: 'PUT', body });

export const listTables = () => api<{ tables: DiningTable[] }>('/payments/tables');
export const createTable = (body: { label: string; menuId: string | null }) => api<{ id: string }>('/payments/tables', { method: 'POST', body });
export const updateTable = (id: string, body: Partial<Pick<DiningTable, 'label' | 'menuId' | 'active'>>) =>
  api<{ ok: true }>(`/payments/tables/${id}`, { method: 'PATCH', body });
export const rotateTable = (id: string) => api<{ url: string }>(`/payments/tables/${id}/rotate`, { method: 'POST' });

export const listBills = (view: 'open' | 'recent') => api<{ bills: Bill[] }>(`/payments/bills?view=${view}`);
export const openBill = (body: { tableId: string; amountAgorot: number; note: string }) => api<{ id: string }>('/payments/bills', { method: 'POST', body });
export const updateBill = (id: string, body: { amountAgorot?: number; note?: string }) => api<{ ok: true }>(`/payments/bills/${id}`, { method: 'PATCH', body });
export const closeBill = (id: string) => api<{ ok: true }>(`/payments/bills/${id}/close`, { method: 'POST' });
export const cancelBill = (id: string) => api<{ ok: true }>(`/payments/bills/${id}/cancel`, { method: 'POST' });

/** "123.4" / "123,40" → 12340 agorot, or null when it is not a valid amount. */
export function shekelsToAgorot(input: string): number | null {
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export function formatAgorot(agorot: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'ILS', minimumFractionDigits: agorot % 100 ? 2 : 0 }).format(agorot / 100);
}
