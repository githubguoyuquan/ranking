import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentController } from './agent.controller';
import { SnapshotAnalyzeService } from './snapshot-analyze.service';

@Module({
  imports: [PrismaModule],
  controllers: [AgentController],
  providers: [SnapshotAnalyzeService],
  exports: [SnapshotAnalyzeService],
})
export class AgentModule {}
