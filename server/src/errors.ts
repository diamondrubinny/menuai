/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/** An error whose code and status are safe to show to the client. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export const badRequest = (code = 'bad_request') => new HttpError(400, code);
export const unauthorized = () => new HttpError(401, 'unauthorized');
export const forbidden = () => new HttpError(403, 'forbidden');
export const notFound = () => new HttpError(404, 'not_found');
export const conflict = (code = 'conflict') => new HttpError(409, code);
