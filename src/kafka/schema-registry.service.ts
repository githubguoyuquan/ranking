import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getKafkaRouteForOutboxType,
  listKafkaRoutedEvents,
} from './event-registry';

/**
 * Confluent / Redpanda 兼容 Schema Registry（REST）。
 * 发布前注册 JSON Schema；消息体仍为 UTF-8 JSON 封套（非 Avro wire）。
 */
@Injectable()
export class SchemaRegistryService implements OnModuleInit {
  private readonly logger = new Logger(SchemaRegistryService.name);
  private readonly registered = new Set<string>();
  private schemaDir = join(__dirname, 'schemas');

  onModuleInit(): void {
    const url = this.baseUrl();
    if (url) {
      this.logger.log(`Schema Registry enabled: ${url}`);
    }
  }

  baseUrl(): string | null {
    const raw = process.env.KAFKA_SCHEMA_REGISTRY_URL?.trim();
    return raw && raw.length > 0 ? raw.replace(/\/$/, '') : null;
  }

  isConfigured(): boolean {
    return this.baseUrl() != null;
  }

  async ping(): Promise<{ ok: boolean; configured: boolean; detail?: string }> {
    const base = this.baseUrl();
    if (!base) {
      return { ok: false, configured: false, detail: 'KAFKA_SCHEMA_REGISTRY_URL not set' };
    }
    try {
      const res = await fetch(`${base}/subjects`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) {
        return {
          ok: false,
          configured: true,
          detail: `HTTP ${res.status}`,
        };
      }
      return { ok: true, configured: true };
    } catch (e) {
      return {
        ok: false,
        configured: true,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /** 启动或首次发布前，将已注册事件的 payload schema 写入 SR */
  async ensureSubjectsRegistered(): Promise<void> {
    if (!this.isConfigured()) return;
    for (const route of listKafkaRoutedEvents()) {
      await this.registerPayloadSchema(route.outboxType, route.schemaRegistrySubject);
    }
  }

  async registerPayloadSchema(
    outboxType: string,
    subject?: string,
  ): Promise<void> {
    const base = this.baseUrl();
    if (!base) return;
    const route = getKafkaRouteForOutboxType(outboxType);
    if (!route) return;
    const sub = subject ?? route.schemaRegistrySubject;
    if (this.registered.has(sub)) return;

    const schemaObj = JSON.parse(
      readFileSync(join(this.schemaDir, route.payloadSchemaFile), 'utf8'),
    ) as object;

    const res = await fetch(
      `${base}/subjects/${encodeURIComponent(sub)}/versions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.schemaregistry.v1+json' },
        body: JSON.stringify({
          schemaType: 'JSON',
          schema: JSON.stringify(schemaObj),
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (res.ok || res.status === 409) {
      this.registered.add(sub);
      return;
    }
    const text = await res.text();
    this.logger.warn(
      `Schema Registry register ${sub} failed: HTTP ${res.status} ${text.slice(0, 200)}`,
    );
  }

  describeSubjects(): Array<{ outboxType: string; subject: string }> {
    return listKafkaRoutedEvents().map((r) => ({
      outboxType: r.outboxType,
      subject: r.schemaRegistrySubject,
    }));
  }
}
