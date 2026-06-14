import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeyGuard } from './api-key.guard';
import type { ApiKeyService } from './api-key.service';
import { REQUEST_AUTH_CONTEXT } from './compliance-auth.types';

describe('ApiKeyGuard', () => {
  const reflector = new Reflector();
  let guard: ApiKeyGuard;
  let authenticateHeaders: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    authenticateHeaders = vi.fn();
    guard = new ApiKeyGuard(
      { authenticateHeaders } as unknown as ApiKeyService,
      reflector,
    );
    delete process.env.API_AUTH_REQUIRED;
    delete process.env.API_ADMIN_OPEN;
  });

  afterEach(() => {
    delete process.env.API_AUTH_REQUIRED;
  });

  function ctx(method: string, path: string, auth?: { scopes: string[] }) {
    authenticateHeaders.mockResolvedValue(auth ?? null);
    const req = {
      method,
      path,
      url: path,
      headers: {},
    } as Record<string, unknown>;
    if (auth) req[REQUEST_AUTH_CONTEXT] = auth;
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };
  }

  it('requires read scope for GET /v1 when auth is default-on', async () => {
    process.env.API_AUTH_REQUIRED = 'true';
    await expect(
      guard.canActivate(
        ctx('GET', '/v1/topics/demo', { scopes: ['write'] }) as never,
      ),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(
        ctx('GET', '/v1/topics/demo', { scopes: ['admin'] }) as never,
      ),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(
        ctx('GET', '/v1/topics/demo', { scopes: [] }) as never,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('requires write scope for POST /v1 when auth is default-on', async () => {
    process.env.API_AUTH_REQUIRED = 'true';
    await expect(
      guard.canActivate(
        ctx('POST', '/v1/rankings/run', { scopes: ['read'] }) as never,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await expect(
      guard.canActivate(
        ctx('POST', '/v1/rankings/run', { scopes: ['write'] }) as never,
      ),
    ).resolves.toBe(true);
  });

  it('allows unscoped access when API_AUTH_REQUIRED=false', async () => {
    process.env.API_AUTH_REQUIRED = 'false';
    await expect(
      guard.canActivate(ctx('GET', '/v1/topics/demo') as never),
    ).resolves.toBe(true);
  });
});
