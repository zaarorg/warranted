/**
 * Redis client interface and factory.
 * Uses a minimal interface so tests can provide mocks without pulling in
 * the full redis package.
 */

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<number>;
  quit(): Promise<unknown>;
}

/**
 * Create a Redis client from the REDIS_URL env var.
 * Returns null if REDIS_URL is not configured (graceful degradation).
 */
export async function createRedisClient(): Promise<RedisClient | null> {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.log("REDIS_URL not configured — agent status cache disabled");
    return null;
  }

  try {
    const { createClient } = await import("redis");
    const client = createClient({ url });
    client.on("error", (err: Error) => console.error("Redis error:", err.message));
    await client.connect();
    console.log("Redis connected");
    return client as unknown as RedisClient;
  } catch (err) {
    console.error("Redis connection failed:", err);
    return null;
  }
}
