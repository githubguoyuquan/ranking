import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { runsRankingWorkers } from '../config/process-role';
import { PostgresPartitionService } from './postgres-partition.service';

/** 每月 1 日 UTC 03:30 预建 PG 月分区；`POSTGRES_PARTITION_CRON_DISABLED=true` 可关 */
@Injectable()
export class PostgresPartitionSchedulerService {
  private readonly logger = new Logger(PostgresPartitionSchedulerService.name);

  constructor(private readonly partitions: PostgresPartitionService) {}

  @Cron('30 3 1 * *', { timeZone: 'UTC' })
  async ensureMonthlyPartitions(): Promise<void> {
    if (!runsRankingWorkers()) return;
    if (process.env.POSTGRES_PARTITION_CRON_DISABLED === 'true') return;

    for (const table of ['RankingItemHistory', 'CrawledUrl'] as const) {
      try {
        const result = await this.partitions.ensureMonthlyPartitions({
          table,
          monthsAhead: 4,
        });
        if (result.partitionsCreated.length > 0) {
          this.logger.log(
            `${table}: created partitions ${result.partitionsCreated.join(', ')}`,
          );
        }
      } catch (e) {
        this.logger.warn(
          `${table} partition cron: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
}
