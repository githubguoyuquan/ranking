import { Controller, Get } from '@nestjs/common';
import { RequireScopes } from '../compliance/api-key.guard';
import { BiService } from './bi.service';

@Controller('admin/bi')
@RequireScopes('admin')
export class BiAdminController {
  constructor(private readonly bi: BiService) {}

  /** BI 大屏聚合：KPI、健康、图表序列、热点涨榜、近期快照 */
  @Get('overview')
  overview() {
    return this.bi.getOverview();
  }
}
