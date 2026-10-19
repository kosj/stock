/** Process-local work reduction; independent server instances have separate limits. */
export class BoundedWorkCache<T> {
  private readonly cached = new Map<string, { value: T; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<T>>();

  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(maxEntries: number, ttlMs: number, now: () => number = Date.now) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  async load(key: string, loader: () => Promise<T>, cacheable: (value: T) => boolean = () => true): Promise<T> {
    const hit = this.cached.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.value;
    this.cached.delete(key);
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= this.maxEntries) throw new Error("Work capacity exceeded");
    const task = Promise.resolve().then(loader).then((value) => {
      if (cacheable(value)) {
        if (this.cached.size >= this.maxEntries) this.cached.delete(this.cached.keys().next().value!);
        this.cached.set(key, { value, expiresAt: this.now() + this.ttlMs });
      }
      return value;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, task);
    return task;
  }
}

/** Share one FIFO concurrency budget across distinct requests; bound queued work too. */
export function createWorkGate(limit: number, maxQueued: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function run<T>(work: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      if (queue.length >= maxQueued) throw new Error("Work queue capacity exceeded");
      await new Promise<void>((resolve) => queue.push(resolve));
    } else active++;
    try { return await work(); }
    finally {
      const next = queue.shift();
      if (next) next(); // Transfer this slot to the queued caller.
      else active--;
    }
  };
}
