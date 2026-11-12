import type { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { RedisVectorCache } from "./vector-cache.js";

/** Keeps what was set and gives it back at an odd place in a bigger Buffer, like the Redis client can. */
function fakeRedis() {
  const store = new Map<string, Buffer>();
  const redis = {
    async set(key: string, value: Buffer) {
      store.set(key, Buffer.from(value));
      return "OK";
    },
    async getBuffer(key: string) {
      const value = store.get(key);
      if (!value) return null;
      const pool = Buffer.alloc(value.length + 3);
      value.copy(pool, 3);
      return pool.subarray(3);
    },
  };
  return redis as unknown as Redis;
}

describe("RedisVectorCache", () => {
  it("gives back the vector it was given, wherever the bytes start", async () => {
    const cache = new RedisVectorCache(fakeRedis());
    await cache.set("emb:a", [0.5, -0.25, 1]);
    expect(await cache.get("emb:a")).toEqual([0.5, -0.25, 1]);
    expect(await cache.get("emb:missing")).toBeNull();
  });
});
