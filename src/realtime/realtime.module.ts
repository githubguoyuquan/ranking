import { Module } from '@nestjs/common';
import { RealtimePublisherService } from './realtime-publisher.service';
import { RealtimeSseController } from './realtime-sse.controller';

@Module({
  providers: [RealtimePublisherService],
  controllers: [RealtimeSseController],
  exports: [RealtimePublisherService],
})
export class RealtimeModule {}
