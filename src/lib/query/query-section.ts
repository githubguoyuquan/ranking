import { HttpException } from '@nestjs/common';

export async function querySection<T>(read: () => Promise<T>, empty: (data: T) => boolean = (v) => v == null) {
  try {
    const data = await read();
    return { status: empty(data) ? 'empty' as const : 'ok' as const, data, sampledAt: new Date().toISOString() };
  } catch (error) {
    // Authorization and invalid requests must never become a successful partial response.
    if (error instanceof HttpException && error.getStatus() < 500) throw error;
    return { status: 'unavailable' as const, data: null, error: { code: 'QUERY_UNAVAILABLE', retryable: true } };
  }
}
