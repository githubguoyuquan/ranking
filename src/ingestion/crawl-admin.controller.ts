import { Controller, Get } from '@nestjs/common';
import { toPlainJson } from '../lib/json';
import { CrawlOpsService } from '../observability/crawl-ops.service';

@Controller('admin/crawl')
export class CrawlAdminController {
  constructor(private readonly crawlOps: CrawlOpsService) {}

  @Get('overview')
  async overview() {
    return toPlainJson(await this.crawlOps.buildOverviewResponse());
  }
}
