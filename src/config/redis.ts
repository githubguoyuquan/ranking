/** ioredis / BullMQ 连接选项（支持 ElastiCache `rediss://` TLS） */
export type RedisConnectionOptions = {
  host: string;
  port: number;
  password?: string;
  username?: string;
  tls?: Record<string, never>;
};

function decodeUserinfo(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function redisConnectionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RedisConnectionOptions {
  const url = env.REDIS_URL?.trim();
  if (url?.startsWith('redis://') || url?.startsWith('rediss://')) {
    const u = new URL(url);
    const opts: RedisConnectionOptions = {
      host: u.hostname,
      port: Number(u.port || 6379),
      password: u.password ? decodeUserinfo(u.password) : undefined,
      username: u.username ? decodeUserinfo(u.username) : undefined,
    };
    if (url.startsWith('rediss://')) {
      opts.tls = {};
    }
    return opts;
  }
  return {
    host: env.REDIS_HOST ?? 'localhost',
    port: Number(env.REDIS_PORT ?? 6379),
    password: env.REDIS_PASSWORD || undefined,
  };
}

/** @deprecated 使用 {@link redisConnectionFromEnv}；保留别名供 BullMQ 配置 */
export function bullMqConnectionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RedisConnectionOptions {
  return redisConnectionFromEnv(env);
}
