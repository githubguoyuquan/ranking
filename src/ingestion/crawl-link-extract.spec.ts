import { describe, expect, it } from 'vitest';
import {
  extractFollowLinks,
  extractSameHostLinks,
  resolveLinkAllowHosts,
} from './crawl-link-extract';

describe('extractSameHostLinks', () => {
  it('keeps same-host links and skips assets', () => {
    const html = `
      <a href="/about">About</a>
      <a href="https://example.com/blog/post">Blog</a>
      <a href="https://other.com/x">Other</a>
      <a href="/style.css">CSS</a>
    `;
    const links = extractSameHostLinks(
      html,
      'https://example.com/',
      'example.com',
      10,
    );
    expect(links).toContain('https://example.com/about');
    expect(links).toContain('https://example.com/blog/post');
    expect(links.some((l) => l.includes('other.com'))).toBe(false);
    expect(links.some((l) => l.includes('style.css'))).toBe(false);
  });
});

describe('extractFollowLinks', () => {
  it('follows extra allow-listed hosts', () => {
    const html = `<a href="https://cdn.example.net/page">CDN</a>`;
    const allow = resolveLinkAllowHosts('https://example.com/', 'https://example.com/');
    allow.add('cdn.example.net');
    const links = extractFollowLinks(html, 'https://example.com/', allow, 5);
    expect(links).toContain('https://cdn.example.net/page');
  });
});
