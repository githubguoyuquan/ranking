import { describe, expect, it } from 'vitest';
import { extractDomFeatures } from './crawl-dom-extract';

describe('extractDomFeatures', () => {
  it('extracts meta description and h1', () => {
    const html = Buffer.from(
      `<!doctype html><html lang="en"><head>
        <meta name="description" content="Sample desc"/>
        <meta property="og:title" content="OG Title"/>
        <link rel="canonical" href="https://example.com/page"/>
      </head><body><h1>Main</h1></body></html>`,
      'utf8',
    );
    const f = extractDomFeatures('text/html', html);
    expect(f?.htmlLang).toBe('en');
    expect(f?.metaDescription).toBe('Sample desc');
    expect(f?.ogTitle).toBe('OG Title');
    expect(f?.canonicalUrl).toBe('https://example.com/page');
    expect(f?.h1).toEqual(['Main']);
  });
});
