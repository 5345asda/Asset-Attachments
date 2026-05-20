export class FakeRedisClient {
  readonly hashes = new Map<string, Record<string, string>>();
  readonly lists = new Map<string, string[]>();
  readonly strings = new Map<string, string>();
  readonly expiries = new Map<string, number>();
  readonly publishes = new Map<string, string[]>();
  readonly commandLog: string[] = [];
  readonly pipelineExecs: string[][] = [];
  connected = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async ping(): Promise<string> {
    this.commandLog.push("ping");
    return "PONG";
  }

  async hSet(key: string, value: Record<string, string>): Promise<number> {
    this.commandLog.push("hSet");
    const existing = this.hashes.get(key) ?? {};
    this.hashes.set(key, {
      ...existing,
      ...value,
    });
    return Object.keys(value).length;
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    this.commandLog.push("hGetAll");
    return { ...(this.hashes.get(key) ?? {}) };
  }

  async rPush(key: string, value: string): Promise<number> {
    this.commandLog.push("rPush");
    const existing = this.lists.get(key) ?? [];
    existing.push(value);
    this.lists.set(key, existing);
    return existing.length;
  }

  async set(key: string, value: string): Promise<string> {
    this.commandLog.push("set");
    this.strings.set(key, value);
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    this.commandLog.push("get");
    return this.strings.get(key) ?? null;
  }

  async del(...keys: string[]): Promise<number> {
    this.commandLog.push("del");
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
    this.commandLog.push("expire");
    this.expiries.set(key, ttlSeconds);
    return 1;
  }

  async exists(key: string): Promise<number> {
    this.commandLog.push("exists");
    return Number(
      this.hashes.has(key)
        || this.lists.has(key)
        || this.strings.has(key),
    );
  }

  async publish(channel: string, message: string): Promise<number> {
    this.commandLog.push("publish");
    const existing = this.publishes.get(channel) ?? [];
    existing.push(message);
    this.publishes.set(channel, existing);
    return 1;
  }

  multi() {
    const steps: Array<() => Promise<unknown>> = [];
    const commands: string[] = [];
    const self = this;

    return {
      hSet(key: string, value: Record<string, string>) {
        commands.push("hSet");
        steps.push(() => self.hSet(key, value));
        return this;
      },
      rPush(key: string, value: string) {
        commands.push("rPush");
        steps.push(() => self.rPush(key, value));
        return this;
      },
      set(key: string, value: string) {
        commands.push("set");
        steps.push(() => self.set(key, value));
        return this;
      },
      expire(key: string, ttlSeconds: number) {
        commands.push("expire");
        steps.push(() => self.expire(key, ttlSeconds));
        return this;
      },
      publish(channel: string, message: string) {
        commands.push("publish");
        steps.push(() => self.publish(channel, message));
        return this;
      },
      async exec(): Promise<unknown[]> {
        self.commandLog.push("multi");
        const results = [];
        for (const step of steps) {
          results.push(await step());
        }
        self.commandLog.push("exec");
        self.pipelineExecs.push([...commands]);
        return results;
      },
    };
  }
}
