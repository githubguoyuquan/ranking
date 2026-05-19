import { Module } from '@nestjs/common';
import { KafkaAdminController } from './kafka-admin.controller';
import { KafkaEventSchemaService } from './kafka-event-schema.service';
import { KafkaProducerService } from './kafka-producer.service';
import { SchemaRegistryService } from './schema-registry.service';

@Module({
  controllers: [KafkaAdminController],
  providers: [KafkaProducerService, KafkaEventSchemaService, SchemaRegistryService],
  exports: [KafkaProducerService, KafkaEventSchemaService, SchemaRegistryService],
})
export class KafkaModule {}
