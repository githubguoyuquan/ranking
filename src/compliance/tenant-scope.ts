import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedRequestContext } from './compliance-auth.types';

/** 多租户读路径：有 API 密钥上下文时仅可见本租户资源 */
export function topicWhereForAuth(
  auth?: AuthenticatedRequestContext | null,
): Prisma.TopicWhereInput {
  if (!auth?.tenantId) return {};
  return { tenantId: auth.tenantId };
}

export function entityWhereForAuth(
  auth?: AuthenticatedRequestContext | null,
): Prisma.EntityWhereInput {
  if (!auth?.tenantId) return {};
  return { tenantId: auth.tenantId };
}

export async function assertTopicAccessible(
  topic: { tenantId: bigint | null } | null,
  auth?: AuthenticatedRequestContext | null,
): Promise<void> {
  if (!topic) return;
  if (!auth?.tenantId) return;
  if (topic.tenantId != null && topic.tenantId !== auth.tenantId) {
    throw new ForbiddenException('topic not accessible for this tenant');
  }
}
