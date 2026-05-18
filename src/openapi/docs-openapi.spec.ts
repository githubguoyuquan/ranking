import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const OPENAPI_DIR = join(__dirname, '../../docs/openapi');

describe('docs/openapi', () => {
  const files = readdirSync(OPENAPI_DIR).filter((f) => f.endsWith('.yaml'));

  it('contains at least one OpenAPI fragment', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s: parses as YAML and declares OpenAPI 3 paths', (name) => {
    const raw = readFileSync(join(OPENAPI_DIR, name), 'utf8');
    const doc = parse(raw) as Record<string, unknown>;
    expect(String(doc.openapi)).toMatch(/^3\./);
    const paths = doc.paths as Record<string, unknown> | undefined;
    expect(paths).toBeTruthy();
    expect(Object.keys(paths!).length).toBeGreaterThan(0);
    for (const [_pathKey, pathItem] of Object.entries(paths!)) {
      expect(pathItem).toBeTruthy();
    }
  });
});
