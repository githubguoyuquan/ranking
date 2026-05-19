import type { ApiKeyScope } from './pii-redact';

export type AuthenticatedRequestContext = {
  tenantId: bigint;
  tenantSlug: string;
  apiKeyId: bigint;
  apiKeyLabel: string;
  scopes: ApiKeyScope[];
};

export const REQUEST_AUTH_CONTEXT = 'rankingAuth';
