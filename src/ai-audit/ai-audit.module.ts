import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiAdminController } from './ai-admin.controller';
import { AiAuditService } from './ai-audit.service';

@Module({
  imports: [PrismaModule],
  controllers: [AiAdminController],
  providers: [AiAuditService],
  exports: [AiAuditService],
})
export class AiAuditModule {}
