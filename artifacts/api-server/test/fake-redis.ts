export class FakeRedisClient {
  readonly hashes = new Map<string, Record<string, string>>();
  readonly lists = new Map<string, string[]>();
  readonly strings = new Map<string, string>();
  readonly expiries = new Map<string, number>();
  readonly publishes = new Map<string, string[]>();
  connected = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async ping(): Promise<string> {
    return "PONG";
  }

  async hSet(key: string, value: Record<string, string>): Promise<number> {
    const existing = this.hashes.get(key) ?? {};
    this.hashes.set(key, {
      ...existing,
      ...value,
    });
    return Object.keys(value).length;
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return { ...(this.hashes.get(key) ?? {}) };
  }

  async rPush(key: string, value: string): Promise<number> {
    const existing = this.lists.get(key) ?? [];
    existing.push(value);
    this.lists.set(key, existing);
    return existing.length;
  }

  async set(key: string, value: string): Promise<string> {
    this.strings.set(key, value);
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;

    for (const key of keys) {
      deleted += Number(this.hashes.delete(key));
      deleted += Number(this.lists.delete(key));
      deleted += Number(this.strings.delete(key));
      deleted += Number(this.expiries.delete(key));
    }

    return deleted;
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    this.expiries.set(key, ttlSeconds);
    return 1;
  }

  async exists(key: string): Promise<number> {
    return Number(
      this.hashes.has(key)
        || this.lists.has(key)
        || this.strings.has(key),
    );
  }

  async publish(channel: string, message: string): Promise<number> {
    const existing = this.publishes.get(channel) ?? [];
    existing.push(message);
    this.publishes.set(channel, existing);
    return 1;
  }
}
