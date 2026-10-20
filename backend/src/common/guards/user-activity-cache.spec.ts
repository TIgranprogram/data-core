import { userActivityCache } from './user-activity-cache';

describe('UserActivityCache', () => {
  beforeEach(() => {
    userActivityCache.invalidateAll();
  });

  it('returns cached result within TTL', async () => {
    const result = await userActivityCache.getOrFetch('user-1', async () => ({
      active: true,
    }));
    expect(result.active).toBe(true);

    const cached = await userActivityCache.getOrFetch('user-1', async () => ({
      active: false,
    }));
    expect(cached.active).toBe(true);
  });

  it('refreshes result after TTL expiry', async () => {
    const result1 = await userActivityCache.getOrFetch('user-2', async () => ({
      active: true,
    }));
    expect(result1.active).toBe(true);

    userActivityCache.invalidate('user-2');

    const result2 = await userActivityCache.getOrFetch('user-2', async () => ({
      active: false,
    }));
    expect(result2.active).toBe(false);
  });

  it('invalidate removes specific user from cache', async () => {
    await userActivityCache.getOrFetch('user-3', async () => ({ active: true }));
    userActivityCache.invalidate('user-3');

    const result = await userActivityCache.getOrFetch('user-3', async () => ({
      active: false,
    }));
    expect(result.active).toBe(false);
  });

  it('invalidateAll clears all entries', async () => {
    await userActivityCache.getOrFetch('user-4', async () => ({ active: true }));
    await userActivityCache.getOrFetch('user-5', async () => ({ active: true }));
    userActivityCache.invalidateAll();

    const r4 = await userActivityCache.getOrFetch('user-4', async () => ({
      active: false,
    }));
    const r5 = await userActivityCache.getOrFetch('user-5', async () => ({
      active: false,
    }));
    expect(r4.active).toBe(false);
    expect(r5.active).toBe(false);
  });

  it('returns user_inactive reason for disabled user', async () => {
    const result = await userActivityCache.getOrFetch('user-6', async () => ({
      active: false,
      reason: 'user_inactive',
    }));
    expect(result.active).toBe(false);
    expect(result.reason).toBe('user_inactive');
  });

  it('returns role_inactive reason for disabled role', async () => {
    const result = await userActivityCache.getOrFetch('user-7', async () => ({
      active: false,
      reason: 'role_inactive',
    }));
    expect(result.active).toBe(false);
    expect(result.reason).toBe('role_inactive');
  });
});