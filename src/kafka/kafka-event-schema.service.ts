import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getKafkaRouteForOutboxType,
  listKafkaRoutedEvents,
  type KafkaRoutedEventDefinition,
} from './event-registry';

@Injectable()
export class KafkaEventSchemaService implements OnModuleInit {
  private readonly logger = new Logger(KafkaEventSchemaService.name);
  private readonly ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
  private validateEnvelope!: ValidateFunction;
  private payloadValidators = new Map<string, ValidateFunction>();
  private schemaDir: string;

  constructor() {
    addFormats(this.ajv);
    this.schemaDir = join(__dirname, 'schemas');
  }

  onModuleInit(): void {
    if (process.env.KAFKA_SKIP_SCHEMA_VALIDATION === 'true') {
      this.logger.warn(
        'KAFKA_SKIP_SCHEMA_VALIDATION=true — SKIPPING JSON Schema validation on Kafka publish (emergency only)',
      );
    }
    const envelope = readSchema(this.schemaDir, 'event-envelope-v1.schema.json');
    this.validateEnvelope = this.ajv.compile(envelope);

    for (const route of listKafkaRoutedEvents()) {
      const sub = readSchema(this.schemaDir, route.payloadSchemaFile);
      this.payloadValidators.set(route.outboxType, this.ajv.compile(sub));
    }
    this.logger.log(
      `Kafka JSON Schema loaded: envelope v1 + ${this.payloadValidators.size} payload schema(s)`,
    );
  }

  private skipValidation(): boolean {
    return process.env.KAFKA_SKIP_SCHEMA_VALIDATION === 'true';
  }

  validateBeforePublish(row: {
    type: string;
    payload: unknown;
    id: bigint;
    createdAt: Date;
  }): { ok: true } | { ok: false; errors: string } {
    if (this.skipValidation()) {
      return { ok: true };
    }

    const route = getKafkaRouteForOutboxType(row.type);
    if (!route) {
      return { ok: false, errors: `type not registered for Kafka: ${row.type}` };
    }

    const envelope = {
      envelopeVersion: 1,
      type: row.type,
      payload: row.payload,
      meta: {
        outboxId: row.id.toString(),
        createdAt: row.createdAt.toISOString(),
      },
    };

    if (!this.validateEnvelope(envelope)) {
      const msg = this.ajv.errorsText(this.validateEnvelope.errors, { separator: '; ' });
      return { ok: false, errors: `envelope: ${msg}` };
    }

    const pv = this.payloadValidators.get(row.type);
    if (!pv) {
      return { ok: false, errors: `no payload schema for ${row.type}` };
    }
    if (!pv(row.payload)) {
      const msg = this.ajv.errorsText(pv.errors, { separator: '; ' });
      return { ok: false, errors: `payload: ${msg}` };
    }

    return { ok: true };
  }

  describeLoaded(): Array<Pick<KafkaRoutedEventDefinition, 'outboxType' | 'payloadSchemaFile'>> {
    return listKafkaRoutedEvents().map((r) => ({
      outboxType: r.outboxType,
      payloadSchemaFile: r.payloadSchemaFile,
    }));
  }
}

function readSchema(dir: string, file: string): object {
  const path = join(dir, file);
  return JSON.parse(readFileSync(path, 'utf8')) as object;
}
