import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * 可选只读副本：`DATABASE_READ_URL` 未设置时回退主库。
 * 用于 rank-history、热点聚合等读多写少路径。
 */
@Injectable()
export class PrismaReadService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaReadService.name);
  readonly usesReadReplica: boolean;

  constructor() {
    const readUrl = process.env.DATABASE_READ_URL?.trim();
    const primary = process.env.DATABASE_URL?.trim();
    const url = readUrl || primary;
    super({ datasources: { db: { url } } });
    this.usesReadReplica = Boolean(readUrl && readUrl !== primary);
  }

  async onModuleInit() {
    await this.$connect();
    if (this.usesReadReplica) {
      this.logger.log('Connected to DATABASE_READ_URL read replica');
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
