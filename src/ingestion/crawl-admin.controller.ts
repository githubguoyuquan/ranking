import { Controller, Get } from '@nestjs/common';
import { toPlainJson } from '../lib/json';
import { IngestionService } from './ingestion.service';

@Controller('admin/crawl')
export class CrawlAdminController {
  constructor(private readonly ingestion: IngestionService) {}

  @Get('overview')
  async overview() {
    return toPlainJson(await this.ingestion.getCrawlOverview());
  }
}
