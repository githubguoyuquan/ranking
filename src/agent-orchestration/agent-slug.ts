/** 从标题生成话题 slug（小写、连字符、≤120） */
export function slugifyTopicTitle(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return s || 'topic';
}
