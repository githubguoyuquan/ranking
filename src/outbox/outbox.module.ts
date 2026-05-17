import { Module } from '@nestjs/common';
import { KafkaModule } from '../kafka/kafka.module';
import { PrismaModule } from '../prisma/prisma.module';
import { OutboxPublisherService } from './outbox-publisher.service';

@Module({
  imports: [PrismaModule, KafkaModule],
  providers: [OutboxPublisherService],
})
export class OutboxModule {}
