import { Module } from '@nestjs/common';
import { RankingCacheService } from './ranking-cache.service';

@Module({
  providers: [RankingCacheService],
  exports: [RankingCacheService],
})
export class CacheModule {}
