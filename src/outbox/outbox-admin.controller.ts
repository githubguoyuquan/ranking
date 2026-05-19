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
  /** 本页最大行数；默认 50；**1–200**（非法时 class-validator 拒绝） */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /** `OutboxEvent.type` 过滤，如 `elasticsearch.entity.sync`、`ranking.snapshot.completed` */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  type?: string;

  /** 为真时仅返回尚未发布到 Kafka / 未完成刷数的行（`publishedAt IS NULL`） */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  pendingOnly?: boolean;
}

/**
 * 只读排查：Outbox 积压与最近错误（**无鉴权**，生产环境请用网关关闭公网或加鉴权）。
 *
 * ## `GET /admin/outbox`
 *
 * **Query**
 * - `limit`：可选；缺省由服务读作 50；有效范围 **1–200**（DTO 校验 + 实现层再次 clamp）
 * - `type`：可选；与 `OutboxEvent.type` **精确匹配**；最长 **120**（`@MaxLength`）
 * - `pendingOnly`：可选；`true` / `"true"` 时仅 **`publishedAt` 为空**（未发布）的行
 *
 * **Response**（JSON）`{ count: number, rows: OutboxEventRow[] }`
 * - `count`：本页返回行数（等于 `rows.length`）
 * - `rows`：经 `toPlainJson` 后的 `OutboxEvent` 列表；`id` 等为十进制字符串，`payload` 为 JSON 对象
 *
 * 常见 **`type` → `payload` 契约**（写入侧由下列 **builder** 固化；常量见 `src/outbox/outbox.constants.ts`）：
 * - `ranking.snapshot.completed`（**Kafka 外发**）→ `buildRankingSnapshotCompletedOutboxPayload`
 * - `clickhouse.ranking.snapshot.ingest`（**CH Flusher** + 可选 Kafka 镜像）→ `buildClickhouseRankingSnapshotOutboxPayload`
 * - `elasticsearch.entity.sync`（**ES Flusher** + 可选 Kafka 镜像）→ `buildElasticEntitySyncOutboxPayload` / `elasticEntitySyncOutboxCreate`
 * - `elasticsearch.crawled_url.sync`（**ES Flusher** + 可选 Kafka 镜像）→ `buildElasticCrawledUrlSyncOutboxPayload` / `elasticCrawledUrlSyncOutboxCreate`
 * - `ranking.followup.requested`（**不发 Kafka**；BullMQ；需 `RANKING_FOLLOWUP_OUTBOX`）→ `buildRankingFollowupRequestedOutboxPayload`
 *
 * 消费边界：`docs/kafka/CONSUMER_BOUNDARY.md`（本仓库无 Kafka Consumer）。
 *
 * 管理台 **`/outbox`**：上述各类 **快捷 `type`、表格摘要列、JSON 契约键高亮**（见 `README`）。
 *
 * **OpenAPI 3** 手写片段（可导入 Swagger UI / Postman）：`docs/openapi/admin-outbox.yaml`。
 */
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
