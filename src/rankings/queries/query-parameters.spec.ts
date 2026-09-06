import { describe, expect, it } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { SnapshotQueryDto, TopicOverviewQueryDto } from '../rankings.controller';
const pipe = new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } });
describe('aggregation query parameters', () => {
  it.each(['false', '0'])('keeps includeNeighbors=%s false despite implicit conversion', async value => {
    const dto = await pipe.transform({ includeNeighbors: value, includeAiStats: value }, { type: 'query', metatype: SnapshotQueryDto });
    expect(dto).toMatchObject({ includeNeighbors: false, includeAiStats: false });
  });
  it('rejects unknown boolean values and out-of-bounds recent lists', async () => {
    await expect(pipe.transform({ includeNeighbors: 'maybe' }, { type: 'query', metatype: SnapshotQueryDto })).rejects.toMatchObject({ status: 400 });
    await expect(pipe.transform({ recentLimit: '11' }, { type: 'query', metatype: TopicOverviewQueryDto })).rejects.toMatchObject({ status: 400 });
  });
});
