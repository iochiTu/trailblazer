import type { VectorCache } from "@traiblazer/llm";
import type { Redis } from "ioredis";

/** How long a question's vector is kept. */
const TTL_SECONDS = 30 * 24 * 3600;

/**
 * Question vectors shared by every API server (docs/EMBEDDINGS.md §4.3), stored as 32-bit floats:
 * 2 KB for 512 numbers. Only the vector and a hash of the question are kept, never the question.
 */
export class RedisVectorCache implements VectorCache {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<number[] | null> {
    const bytes = await this.redis.getBuffer(key);
    if (!bytes || bytes.length % 4) return null;
    // Read number by number: a Buffer from the Redis client can start anywhere in its memory, and a
    // Float32Array view needs a start that is a multiple of 4.
    return Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4));
  }

  async set(key: string, vector: number[]): Promise<void> {
    const bytes = Buffer.alloc(vector.length * 4);
    for (const [i, value] of vector.entries()) bytes.writeFloatLE(value, i * 4);
    await this.redis.set(key, bytes, "EX", TTL_SECONDS);
  }
}
