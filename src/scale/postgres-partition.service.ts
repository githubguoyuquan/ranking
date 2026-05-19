import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type PartitionEnsureResult = {
  table: string;
  partitionsCreated: string[];
  skipped: string[];
  warnings: string[];
};

/**
 * 为 `RankingItemHistory` / `CrawledUrl` 按月 RANGE 分区（若父表已声明 PARTITION BY RANGE）。
 * 新环境可先执行 `prisma/migrations/optional_partition_parent.sql` 再调用 ensure。
 */
@Injectable()
export class PostgresPartitionService {
  private readonly logger = new Logger(PostgresPartitionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async isTablePartitioned(tableName: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ partrelid: unknown }>>`
      SELECT c.relid::regclass AS partrelid
      FROM pg_partitioned_table pt
      JOIN pg_class c ON c.oid = pt.partrelid
      WHERE c.relname = ${tableName}
    `;
    return rows.length > 0;
  }

  async ensureMonthlyPartitions(args: {
    table: 'RankingItemHistory' | 'CrawledUrl';
    monthsAhead?: number;
  }): Promise<PartitionEnsureResult> {
    const pgTable = args.table === 'RankingItemHistory' ? 'RankingItemHistory' : 'CrawledUrl';
    const dateCol = args.table === 'RankingItemHistory' ? 'asOf' : 'fetchedAt';
    const monthsAhead = Math.min(Math.max(args.monthsAhead ?? 3, 1), 24);

    const result: PartitionEnsureResult = {
      table: pgTable,
      partitionsCreated: [],
      skipped: [],
      warnings: [],
    };

    const partitioned = await this.isTablePartitioned(pgTable);
    if (!partitioned) {
      result.warnings.push(
        `${pgTable} is not PARTITION BY RANGE yet. Run optional SQL in prisma/migrations/optional_partition_parent.sql on a maintenance window, or ignore for dev.`,
      );
      return result;
    }

    const now = new Date();
    for (let i = 0; i <= monthsAhead; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const suffix = `${y}_${String(m).padStart(2, '0')}`;
      const child = `${pgTable.toLowerCase()}_${suffix}`;
      const from = `${y}-${String(m).padStart(2, '0')}-01`;
      const nextMonth = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
      const to = `${nextMonth.y}-${String(nextMonth.m).padStart(2, '0')}-01`;

      try {
        await this.prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "${child}" PARTITION OF "${pgTable}"
          FOR VALUES FROM ('${from}') TO ('${to}')
        `);
        result.partitionsCreated.push(child);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('already exists')) {
          result.skipped.push(child);
        } else {
          this.logger.warn(`partition ${child}: ${msg}`);
          result.warnings.push(`${child}: ${msg}`);
        }
      }
    }

    void dateCol;
    return result;
  }
}
