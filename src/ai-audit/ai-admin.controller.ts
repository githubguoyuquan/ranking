import { Controller, Get, Query } from '@nestjs/common';
import { AiAuditCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { toPlainJson } from '../lib/json';
import { AiAuditService } from './ai-audit.service';

const AUDIT_CATEGORIES = ['CHAT_COMPLETION', 'EMBEDDING'] as const;

class AiAuditListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsIn(AUDIT_CATEGORIES)
  category?: AiAuditCategory;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  source?: string;
}

@Controller()
export class AiAdminController {
  constructor(private readonly audit: AiAuditService) {}

  /** AI 全图谱：UTC 当日配额、按 agentKind / source 聚合、近期带 AI 的快照梗概 */
  @Get('admin/ai/spectrum')
  async spectrum() {
    return toPlainJson(await this.audit.getSpectrumSummary());
  }

  /** 不可变审计流水（配额拒绝、聊天 token、embedding 批次等） */
  @Get('admin/ai/audit-events')
  async auditEvents(@Query() query: AiAuditListQueryDto) {
    return toPlainJson(
      await this.audit.listAuditEvents({
        limit: query.limit ?? 80,
        category: query.category,
        source: query.source,
      }),
    );
  }
}
