import { Module } from '@nestjs/common';
import { KafkaEventSchemaService } from './kafka-event-schema.service';
import { KafkaProducerService } from './kafka-producer.service';

@Module({
  providers: [KafkaProducerService, KafkaEventSchemaService],
  exports: [KafkaProducerService, KafkaEventSchemaService],
})
export class KafkaModule {}
