import type { Request } from 'express';
import { REQUEST_AUTH_CONTEXT, type AuthenticatedRequestContext } from './compliance-auth.types';

export function getAuthFromRequest(
  req: Request,
): AuthenticatedRequestContext | undefined {
  return (req as Request & { [REQUEST_AUTH_CONTEXT]?: AuthenticatedRequestContext })[
    REQUEST_AUTH_CONTEXT
  ];
}
