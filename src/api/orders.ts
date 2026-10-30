/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/** Orders from the menu: staff side. Roles are enforced by the server on every call. */
import { api } from './client';

export interface OrderLine {
  name: string;
  variantLabel: string | null;
  unitAgorot: number;
  qty: number;
  note: string;
}

export interface StaffOrder {
  id: string;
  status: 'new' | 'accepted' | 'rejected';
  totalAgorot: number;
  rejectReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  tableId: string;
  tableLabel: string;
  billId: string | null;
  lines: OrderLine[];
}

export const listOrders = (view: 'open' | 'recent') => api<{ enabled: boolean; orders: StaffOrder[] }>(`/orders?view=${view}`);
export const acceptOrder = (id: string) => api<{ ok: true; billId: string }>(`/orders/${id}/accept`, { method: 'POST' });
export const rejectOrder = (id: string, reason: string) => api<{ ok: true }>(`/orders/${id}/reject`, { method: 'POST', body: { reason } });
/** Owner only. */
export const setOrdering = (enabled: boolean) => api<{ ok: true }>('/orders/settings', { method: 'PUT', body: { enabled } });
