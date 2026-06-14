import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  apiKeyPrefix,
  extractApiKeyFromHeaders,
  generateApiKeyPlaintext,
  hashApiKey,
} from './api-key-crypto';
import type { AuthenticatedRequestContext } from './compliance-auth.types';
import { parseApiKeyScopes } from './pii-redact';

export function apiAuthRequired(): boolean {
  return process.env.API_AUTH_REQUIRED !== 'false';
}

@Injectable()
export class ApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  async authenticateHeaders(
    headers: Record<string, string | string[] | undefined>,
  ): Promise<AuthenticatedRequestContext | null> {
    const plaintext = extractApiKeyFromHeaders(headers);
    if (!plaintext) {
      if (apiAuthRequired()) {
        throw new UnauthorizedException('API key required (X-API-Key or Authorization: Bearer)');
      }
      return null;
    }
    return this.authenticatePlaintext(plaintext);
  }

  async authenticatePlaintext(plaintext: string): Promise<AuthenticatedRequestContext> {
    const keyHash = hashApiKey(plaintext);
    const row = await this.prisma.apiKey.findFirst({
      where: { keyHash, revokedAt: null },
      include: { tenant: true },
    });
    if (!row) throw new UnauthorizedException('invalid API key');

    await this.prisma.apiKey.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      tenantId: row.tenantId,
      tenantSlug: row.tenant.slug,
      apiKeyId: row.id,
      apiKeyLabel: row.label,
      scopes: parseApiKeyScopes(row.scopes),
    };
  }

  async createApiKey(args: {
    tenantId: bigint;
    label?: string;
    scopes?: string[];
  }): Promise<{ plaintext: string; apiKeyId: string; keyPrefix: string }> {
    const plaintext = generateApiKeyPlaintext();
    const row = await this.prisma.apiKey.create({
      data: {
        tenantId: args.tenantId,
        label: args.label?.trim() ?? '',
        keyPrefix: apiKeyPrefix(plaintext),
        keyHash: hashApiKey(plaintext),
        scopes: args.scopes ?? ['read', 'write', 'admin'],
      },
    });
    return {
      plaintext,
      apiKeyId: row.id.toString(),
      keyPrefix: row.keyPrefix,
    };
  }

  async ensureDefaultTenant(): Promise<{ id: bigint; slug: string }> {
    const t = await this.prisma.tenant.upsert({
      where: { slug: 'default' },
      create: { slug: 'default', name: 'Default tenant' },
      update: {},
    });
    return { id: t.id, slug: t.slug };
  }
}
