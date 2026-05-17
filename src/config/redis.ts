/** Parsed options for BullMQ/ioredis (avoid passing URL string — some Nest versions differ). */
export function bullMqConnectionFromEnv(): {
  host: string;
  port: number;
  password?: string;
  username?: string;
} {
  const url = process.env.REDIS_URL;
  if (url?.startsWith('redis://') || url?.startsWith('rediss://')) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port || 6379),
      password: u.password || undefined,
      username: u.username || undefined,
    };
  }
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}
