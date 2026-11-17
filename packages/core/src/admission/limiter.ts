import { Redis } from "ioredis";

/**
 * Counters shared by all API servers: fixed-window rate limits and concurrency slots.
 * Redis when REDIS_URL is set (required with more than one API server); in-memory otherwise.
 */
export interface Limiter {
  /** Counts one hit in the current window; false when the limit is already reached. */
  hit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
  /** Takes a concurrency slot; returns a release function, or null when all slots are busy. */
  acquire(key: string, max: number, ttlSeconds: number): Promise<(() => Promise<void>) | null>;
}

export class MemoryLimiter implements Limiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly slots = new Map<string, number>();

  async hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const now = Date.now();
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return limit >= 1;
    }
    if (current.count >= limit) return false;
    current.count++;
    return true;
  }

  async acquire(key: string, max: number): Promise<(() => Promise<void>) | null> {
    const used = this.slots.get(key) ?? 0;
    if (used >= max) return null;
    this.slots.set(key, used + 1);
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      const left = (this.slots.get(key) ?? 1) - 1;
      if (left > 0) this.slots.set(key, left);
      else this.slots.delete(key);
    };
  }
}

export class RedisLimiter implements Limiter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "tb:limit:",
  ) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const window = Math.floor(Date.now() / 1000 / windowSeconds);
    const k = `${this.prefix}${key}:${window}`;
    const [[, count]] = (await this.redis
      .multi()
      .incr(k)
      .expire(k, windowSeconds * 2)
      .exec()) as [[Error | null, number]];
    return count <= limit;
  }

  async acquire(key: string, max: number, ttlSeconds: number): Promise<(() => Promise<void>) | null> {
    const k = `${this.prefix}slots:${key}`;
    // The TTL frees slots held by a crashed server; answers finish well within it.
    const [[, used]] = (await this.redis.multi().incr(k).expire(k, ttlSeconds).exec()) as [
      [Error | null, number],
    ];
    if (used > max) {
      await this.redis.decr(k);
      return null;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      const left = await this.redis.decr(k);
      if (left < 0) await this.redis.set(k, 0, "EX", ttlSeconds);
    };
  }
}

export function createLimiterStore(url?: string) {
  const redis = url ? new Redis(url, { maxRetriesPerRequest: 2 }) : null;
  return { redis, limiter: redis ? new RedisLimiter(redis) : new MemoryLimiter() };
}
