/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/** Team management (owner only — enforced by the server on every call). */
import { api, type ApiResult } from './client';

export type Role = 'owner' | 'editor' | 'viewer';
export const ROLES: Role[] = ['owner', 'editor', 'viewer'];

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
}

export const listUsers = () => api<{ users: TeamMember[] }>('/users');

/** Without an email provider, the server returns the one-time link so the owner can share it. */
export const inviteUser = (body: { email: string; name: string; role: Role }) =>
  api<{ user: TeamMember; inviteLink?: string }>('/users', { method: 'POST', body });

export const updateUser = (id: string, body: Partial<Pick<TeamMember, 'name' | 'role' | 'disabled'>>) =>
  api<{ user: TeamMember }>(`/users/${id}`, { method: 'PATCH', body });

export const resendInvite = (id: string) => api<{ ok: true; inviteLink?: string }>(`/users/${id}/invite`, { method: 'POST' });

export type { ApiResult };
