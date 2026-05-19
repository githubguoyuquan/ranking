import { Controller, Get } from '@nestjs/common';
import { listKafkaRoutedEvents } from './event-registry';
import { KafkaEventSchemaService } from './kafka-event-schema.service';
import { KafkaProducerService } from './kafka-producer.service';
import { SchemaRegistryService } from './schema-registry.service';
import { toPlainJson } from '../lib/json';

@Controller()
export class KafkaAdminController {
  constructor(
    private readonly kafka: KafkaProducerService,
    private readonly schemas: KafkaEventSchemaService,
    private readonly registry: SchemaRegistryService,
  ) {}

  @Get('admin/kafka/events')
  events() {
    return toPlainJson({
      envelopeVersion: 1,
      consumerBoundary:
        'This repository publishes to Kafka only; it does not run Kafka consumer groups. See docs/kafka/CONSUMER_BOUNDARY.md.',
      routes: listKafkaRoutedEvents().map((r) => ({
        outboxType: r.outboxType,
        defaultTopic: r.defaultTopic,
        topicEnvVar: r.topicEnvVar,
        payloadSchemaFile: r.payloadSchemaFile,
        schemaRegistrySubject: r.schemaRegistrySubject,
        description: r.description,
        publishToKafka: r.publishToKafka,
        sideEffect: r.sideEffect,
      })),
      loadedPayloadSchemas: this.schemas.describeLoaded(),
      schemaRegistrySubjects: this.registry.describeSubjects(),
    });
  }

  @Get('admin/kafka/status')
  async status() {
    const [kafka, registry] = await Promise.all([
      this.kafka.ping(),
      this.registry.ping(),
    ]);
    return toPlainJson({
      kafka,
      schemaRegistry: registry,
      schemaValidationSkipped: process.env.KAFKA_SKIP_SCHEMA_VALIDATION === 'true',
    });
  }
}
