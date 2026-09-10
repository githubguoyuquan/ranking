import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|js|mjs|cjs)$/.test(name) ? [path] : [];
  });
}

describe('paid AI boundary', () => {
  it('contains no paid AI endpoint or credential hook in runtime source', () => {
    const roots = [join(process.cwd(), 'src'), join(process.cwd(), 'web', 'src')];
    const forbidden = [
      /api\.openai\.com/i,
      new RegExp(`OPENAI${'_API_KEY'}`),
      new RegExp(`ANTHROPIC${'_API_KEY'}`),
      /api\.anthropic\.com/i,
      /generativelanguage\.googleapis\.com/i,
    ];
    const violations = roots.flatMap(sourceFiles).flatMap((path) => {
      const contents = readFileSync(path, 'utf8');
      return forbidden.some((pattern) => pattern.test(contents)) ? [path] : [];
    });
    expect(violations).toEqual([]);
  });
});
