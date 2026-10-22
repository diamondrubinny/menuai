/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { forbidden, unauthorized } from '../errors';
import { hasRole, type Role } from './roles';
import { userForSession, type User } from './service';

export const SESSION_COOKIE = 'menuai_session';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

/** preHandler: requires a valid session whose user has at least `role`. Checked server-side on every request. */
export function requireRole(role: Role) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const user = await userForSession(req.server.deps.db, req.cookies[SESSION_COOKIE]);
    if (!user) throw unauthorized();
    if (!hasRole(user.role, role)) throw forbidden();
    req.user = user;
  };
}
