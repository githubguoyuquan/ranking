import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { ComplianceAuditAction } from '@prisma/client';
import type { Request, Response } from 'express';
import { toPlainJson } from '../lib/json';
import { PrismaService } from '../prisma/prisma.service';
import { PublicRoute, RequireScopes } from './api-key.guard';
import { ApiKeyService } from './api-key.service';
import { REQUEST_AUTH_CONTEXT, type AuthenticatedRequestContext } from './compliance-auth.types';
import { ComplianceAuditService } from './compliance-audit.service';
import {
  ComplianceExportService,
  type ComplianceExportFormat,
} from './compliance-export.service';

class CreateTenantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}

class CreateApiKeyDto {
  @IsString()
  tenantId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsArray()
  @IsIn(['read', 'write', 'admin'], { each: true })
  scopes?: Array<'read' | 'write' | 'admin'>;
}

class ComplianceExportQueryDto {
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: ComplianceExportFormat;
}

class AuditListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsIn([
    'API_KEY_AUTH',
    'SNAPSHOT_COMPLIANCE_EXPORT',
    'SCORE_BREAKDOWN_EXPORT',
    'ENTITY_PII_ACCESS',
  ])
  action?: ComplianceAuditAction;
}

function authFromReq(req: Request): AuthenticatedRequestContext | undefined {
  return (req as Request & { [REQUEST_AUTH_CONTEXT]?: AuthenticatedRequestContext })[
    REQUEST_AUTH_CONTEXT
  ];
}

@Controller()
export class ComplianceAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeyService,
    private readonly audit: ComplianceAuditService,
    private readonly exportSvc: ComplianceExportService,
  ) {}

  @Get('admin/compliance/tenants')
  @RequireScopes('admin')
  async listTenants() {
    const rows = await this.prisma.tenant.findMany({ orderBy: { id: 'asc' } });
    return toPlainJson(rows);
  }

  @Post('admin/compliance/tenants')
  @RequireScopes('admin')
  async createTenant(@Body() body: CreateTenantDto) {
    const row = await this.prisma.tenant.create({
      data: { slug: body.slug.trim(), name: body.name.trim() },
    });
    return toPlainJson(row);
  }

  @Post('admin/compliance/api-keys')
  @RequireScopes('admin')
  async createApiKey(@Body() body: CreateApiKeyDto) {
    let tenantId: bigint;
    try {
      tenantId = BigInt(body.tenantId);
    } catch {
      throw new BadRequestException('invalid tenantId');
    }
    const created = await this.apiKeys.createApiKey({
      tenantId,
      label: body.label,
      scopes: body.scopes,
    });
    return toPlainJson({
      ...created,
      warning: 'Store plaintext key now; it cannot be retrieved again.',
    });
  }

  @Get('admin/compliance/audit-events')
  @RequireScopes('admin')
  async auditEvents(@Query() query: AuditListQueryDto, @Req() req: Request) {
    const auth = authFromReq(req);
    const rows = await this.audit.listRecent({
      limit: query.limit,
      action: query.action,
      tenantId: auth?.tenantId,
    });
    return toPlainJson({ total: rows.length, events: rows });
  }

  /**
   * 法务可解释性导出：ScoreModel + ScoreBreakdown 行 + RankingItem.scoreBreakdown
   */
  @Get('admin/compliance/snapshots/:id/export')
  @RequireScopes('admin')
  async exportSnapshot(
    @Param('id') id: string,
    @Query() query: ComplianceExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    let snapshotId: bigint;
    try {
      snapshotId = BigInt(id);
    } catch {
      throw new BadRequestException('invalid snapshot id');
    }
    const format = query.format ?? 'json';
    const { contentType, body } = await this.exportSvc.exportSnapshotCompliance({
      snapshotId,
      format,
      auth: authFromReq(req),
    });
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="snapshot-${id}-compliance.${format === 'csv' ? 'csv' : 'json'}"`,
    );
    res.send(body);
  }

  /** 开发/bootstrap：确保 default 租户存在 */
  @Post('admin/compliance/bootstrap-default-tenant')
  @PublicRoute()
  async bootstrapDefault() {
    const t = await this.apiKeys.ensureDefaultTenant();
    return toPlainJson(t);
  }
}
