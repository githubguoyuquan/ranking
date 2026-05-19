import { describe, expect, it } from 'vitest';
import { slugifyTopicTitle } from './agent-slug';

describe('slugifyTopicTitle', () => {
  it('normalizes spaces and case', () => {
    expect(slugifyTopicTitle('Global Female Singers')).toBe(
      'global-female-singers',
    );
  });

  it('falls back when empty', () => {
    expect(slugifyTopicTitle('!!!')).toBe('topic');
  });
});
