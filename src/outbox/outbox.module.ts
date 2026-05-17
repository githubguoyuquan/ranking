import { Module } from '@nestjs/common';
import { KafkaModule } from '../kafka/kafka.module';
import { PrismaModule } from '../prisma/prisma.module';
import { OutboxAdminController } from './outbox-admin.controller';
import { OutboxPublisherService } from './outbox-publisher.service';

@Module({
  imports: [PrismaModule, KafkaModule],
  controllers: [OutboxAdminController],
  providers: [OutboxPublisherService],
})
export class OutboxModule {}
