import { Global, Module } from '@nestjs/common';
import { RankingCacheService } from './ranking-cache.service';
import { RedisHealthService } from './redis-health.service';

@Global()
@Module({
  providers: [RankingCacheService, RedisHealthService],
  exports: [RankingCacheService, RedisHealthService],
})
export class CacheModule {}
