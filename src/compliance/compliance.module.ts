import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RankingsModule } from '../rankings/rankings.module';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';
import { ComplianceAdminController } from './compliance-admin.controller';
import { ComplianceAuditService } from './compliance-audit.service';
import { ComplianceExportService } from './compliance-export.service';

@Global()
@Module({
  imports: [RankingsModule],
  controllers: [ComplianceAdminController],
  providers: [
    ApiKeyService,
    ComplianceAuditService,
    ComplianceExportService,
    ApiKeyGuard,
    { provide: APP_GUARD, useClass: ApiKeyGuard },
  ],
  exports: [ApiKeyService, ComplianceAuditService, ComplianceExportService],
})
export class ComplianceModule {}
