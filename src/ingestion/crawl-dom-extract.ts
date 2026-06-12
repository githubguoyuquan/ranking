export type CrawlDomFeatures = {
  schemaVersion: 1;
  htmlLang?: string;
  metaDescription?: string;
  ogTitle?: string;
  ogDescription?: string;
  canonicalUrl?: string;
  h1?: string[];
};

const META_CONTENT = /content=["']([^"']*)["']/i;
const META_NAME = /name=["']([^"']*)["']/i;
const META_PROPERTY = /property=["']([^"']*)["']/i;

function readMetaContent(tag: string): string | null {
  const m = META_CONTENT.exec(tag);
  if (!m) return null;
  return decodeBasicHtmlEntities(m[1].replace(/\s+/g, ' ').trim()) || null;
}

function decodeBasicHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

function stripTags(s: string): string {
  return decodeBasicHtmlEntities(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

/** 从 HTML 缓冲提取轻量 DOM 特征（不依赖 cheerio） */
export function extractDomFeatures(
  mimeType: string | null,
  buf: Buffer,
): CrawlDomFeatures | null {
  const m = (mimeType ?? '').toLowerCase();
  if (!m.includes('html') && m !== 'application/xhtml+xml' && !m.startsWith('text/')) {
    return null;
  }
  const cap = Math.min(buf.length, 800_000);
  const html = buf.toString('utf8', 0, cap);

  const htmlLang = /<html[^>]*\slang=["']([a-zA-Z-]{2,16})["']/i.exec(html)?.[1];

  let metaDescription: string | undefined;
  let ogTitle: string | undefined;
  let ogDescription: string | undefined;

  const metaRe = /<meta\b[^>]*>/gi;
  let metaMatch: RegExpExecArray | null;
  while ((metaMatch = metaRe.exec(html)) !== null) {
    const tag = metaMatch[0];
    const name = META_NAME.exec(tag)?.[1]?.toLowerCase();
    const prop = META_PROPERTY.exec(tag)?.[1]?.toLowerCase();
    const content = readMetaContent(tag);
    if (!content) continue;
    if (name === 'description' && !metaDescription) {
      metaDescription = content.slice(0, 512);
    }
    if (prop === 'og:title' && !ogTitle) {
      ogTitle = content.slice(0, 512);
    }
    if (prop === 'og:description' && !ogDescription) {
      ogDescription = content.slice(0, 512);
    }
  }

  const canonicalRaw = /<link[^>]*rel=["']canonical["'][^>]*>/i.exec(html)?.[0];
  let canonicalUrl: string | undefined;
  if (canonicalRaw) {
    const href = /href=["']([^"']+)["']/i.exec(canonicalRaw)?.[1]?.trim();
    if (href) canonicalUrl = href.slice(0, 2048);
  }

  const h1: string[] = [];
  const h1Re = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
  let h1Match: RegExpExecArray | null;
  while ((h1Match = h1Re.exec(html)) !== null && h1.length < 5) {
    const t = stripTags(h1Match[1]);
    if (t) h1.push(t.slice(0, 256));
  }

  if (!htmlLang && !metaDescription && !ogTitle && !ogDescription && !canonicalUrl && h1.length === 0) {
    return null;
  }

  return {
    schemaVersion: 1,
    ...(htmlLang ? { htmlLang } : {}),
    ...(metaDescription ? { metaDescription } : {}),
    ...(ogTitle ? { ogTitle } : {}),
    ...(ogDescription ? { ogDescription } : {}),
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(h1.length > 0 ? { h1 } : {}),
  };
}

export function crawlDomFeaturesEnabled(): boolean {
  return process.env.CRAWL_DOM_FEATURES !== 'false';
}
