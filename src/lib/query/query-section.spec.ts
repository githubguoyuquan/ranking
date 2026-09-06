import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { querySection } from './query-section';
describe('query sections', () => {
  it('distinguishes an empty result from unavailable without exposing internal errors', async () => {
    expect(await querySection(async () => [])).toMatchObject({ status: 'ok', data: [] });
    expect(await querySection(async () => [], rows => rows.length === 0)).toMatchObject({ status: 'empty', data: [] });
    const failed = await querySection(async () => { throw new Error('secret database connection'); });
    expect(failed).toEqual({ status: 'unavailable', data: null, error: { code: 'QUERY_UNAVAILABLE', retryable: true } });
  });
  it('never hides authorization failures as partial success', async () => {
    await expect(querySection(async () => { throw new ForbiddenException(); })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
