import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ElasticService } from './elastic.service';
import { SearchController } from './search.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SearchController],
  providers: [ElasticService],
  exports: [ElasticService],
})
export class SearchModule {}
