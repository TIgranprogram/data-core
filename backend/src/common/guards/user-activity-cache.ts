interface ActivityCheck {
  active: boolean;
  reason?: string;
}

class UserActivityCache {
  private readonly cache = new Map<
    string,
    { result: ActivityCheck; expiresAt: number }
  >();
  private readonly TTL_MS = 30_000;

  async getOrFetch(
    userId: string,
    fetch: () => Promise<ActivityCheck>,
  ): Promise<ActivityCheck> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    const result = await fetch();
    this.cache.set(userId, { result, expiresAt: Date.now() + this.TTL_MS });
    return result;
  }

  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}

export const userActivityCache = new UserActivityCache();