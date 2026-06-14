import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiKeyService, apiAuthRequired } from './api-key.service';
import { REQUEST_AUTH_CONTEXT, type AuthenticatedRequestContext } from './compliance-auth.types';
import type { ApiKeyScope } from './pii-redact';

export const PUBLIC_ROUTE_KEY = 'rankingPublicRoute';
export const REQUIRED_SCOPES_KEY = 'rankingRequiredScopes';

/** V1 读接口最低 scope（写接口需 write/admin） */
const V1_READ_SCOPES: ApiKeyScope[] = ['read', 'write', 'admin'];
const V1_WRITE_SCOPES: ApiKeyScope[] = ['write', 'admin'];

/** 健康检查、探活等无需密钥 */
export const PublicRoute = () => SetMetadata(PUBLIC_ROUTE_KEY, true);

export const RequireScopes = (...scopes: ApiKeyScope[]) =>
  SetMetadata(REQUIRED_SCOPES_KEY, scopes);

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & {
      [REQUEST_AUTH_CONTEXT]?: AuthenticatedRequestContext;
    }>();

    const path = req.path ?? req.url ?? '';
    if (this.isAlwaysPublicPath(path)) return true;

    const auth = await this.apiKeys.authenticateHeaders(
      req.headers as Record<string, string | string[] | undefined>,
    );
    if (auth) {
      req[REQUEST_AUTH_CONTEXT] = auth;
    }

    const required = this.reflector.getAllAndOverride<ApiKeyScope[] | undefined>(
      REQUIRED_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (required?.length) {
      if (!auth) {
        const adminOpen =
          !apiAuthRequired() && process.env.API_ADMIN_OPEN !== 'false';
        if (!adminOpen) {
          throw new UnauthorizedException('API key required for this route');
        }
      } else {
        const ok = required.some((s) => auth.scopes.includes(s));
        if (!ok) {
          throw new UnauthorizedException(
            `missing scope (need one of: ${required.join(', ')})`,
          );
        }
      }
    } else if (auth && apiAuthRequired()) {
      this.enforceV1Scopes(req, auth);
    }

    return true;
  }

  /** /v1 默认强制 read/write scope（鉴权开启时） */
  private enforceV1Scopes(
    req: Request & { [REQUEST_AUTH_CONTEXT]?: AuthenticatedRequestContext },
    auth: AuthenticatedRequestContext,
  ): void {
    const path = req.path ?? req.url ?? '';
    if (!path.startsWith('/v1/') || this.isAlwaysPublicPath(path)) return;

    const method = (req.method ?? 'GET').toUpperCase();
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const allowed = isWrite ? V1_WRITE_SCOPES : V1_READ_SCOPES;
    if (!allowed.some((s) => auth.scopes.includes(s))) {
      throw new UnauthorizedException(
        isWrite
          ? 'write or admin scope required for this route'
          : 'read scope required for this route',
      );
    }
  }

  private isAlwaysPublicPath(path: string): boolean {
    return (
      path === '/health' ||
      path.startsWith('/health/') ||
      path === '/v1/realtime/stream'
    );
  }
}
