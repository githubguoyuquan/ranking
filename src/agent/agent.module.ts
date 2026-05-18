import { Module } from '@nestjs/common';
import { AiAuditModule } from '../ai-audit/ai-audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentController } from './agent.controller';
import { SnapshotAnalyzeService } from './snapshot-analyze.service';

@Module({
  imports: [PrismaModule, AiAuditModule],
  controllers: [AgentController],
  providers: [SnapshotAnalyzeService],
  exports: [SnapshotAnalyzeService],
})
export class AgentModule {}
