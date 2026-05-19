import { Module } from '@nestjs/common';
import { runsOutboxKafkaPublisher } from '../config/process-role';
import { KafkaModule } from '../kafka/kafka.module';
import { PrismaModule } from '../prisma/prisma.module';
import { OutboxAdminController } from './outbox-admin.controller';
import { OutboxPublisherService } from './outbox-publisher.service';

@Module({
  imports: [PrismaModule, KafkaModule],
  controllers: [OutboxAdminController],
  providers: [
    ...(runsOutboxKafkaPublisher() ? [OutboxPublisherService] : []),
  ],
})
export class OutboxModule {}
