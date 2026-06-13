import { describe, expect, it } from 'vitest';
import {
  isPathAllowedByRobots,
  isUrlAllowedByRobots,
  parseRobotsTxt,
} from './crawl-robots';

describe('parseRobotsTxt', () => {
  it('parses disallow for wildcard agent', () => {
    const rules = parseRobotsTxt(`
User-agent: *
Disallow: /private/
Allow: /private/public/
`);
    expect(isPathAllowedByRobots('/public/page', rules)).toBe(true);
    expect(isPathAllowedByRobots('/private/secret', rules)).toBe(false);
    expect(isPathAllowedByRobots('/private/public/x', rules)).toBe(true);
  });
});

describe('isUrlAllowedByRobots', () => {
  it('checks pathname', () => {
    const rules = parseRobotsTxt('User-agent: *\nDisallow: /admin');
    expect(isUrlAllowedByRobots('https://ex.com/admin/x', rules)).toBe(false);
    expect(isUrlAllowedByRobots('https://ex.com/blog', rules)).toBe(true);
  });
});
