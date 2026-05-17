import { Controller, Get, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { toPlainJson } from '../lib/json';
import { PrismaService } from '../prisma/prisma.service';

class OutboxListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  type?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  pendingOnly?: boolean;
}

/** 只读排查：Outbox 积压与最近错误（无鉴权，生产请前置网关） */
@Controller()
export class OutboxAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('admin/outbox')
  async listOutbox(@Query() query: OutboxListQueryDto) {
    const take = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const type = query.type?.trim();
    const rows = await this.prisma.outboxEvent.findMany({
      where: {
        ...(type ? { type } : {}),
        ...(query.pendingOnly === true ? { publishedAt: null } : {}),
      },
      orderBy: { id: 'desc' },
      take,
    });
    return toPlainJson({ count: rows.length, rows });
  }
}
