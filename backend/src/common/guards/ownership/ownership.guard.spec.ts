import { ExecutionContext, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OwnershipGuard } from './ownership.guard';
import {
  OWNER_ONLY_KEY,
} from './ownership.decorator';
import type { AuthenticatedUserLike } from '../../contracts/rbac-contract';

/**
 * TZ-251 §ШАГ 5 — Unit tests for the ownership authorization ladder.
 *
 * После чистки CRM-домена (H) в ядре нет ни одного `@OwnerOnly`-
 * контроллера; единственная user-owned сущность в матрице — `photo`.
 * `lookupDocument()` не инжектирует модели (все прежние owned-сущности
 * удалены) и возвращает `null` → любой не-admin запрос на owned-сущность
 * получает 404. Когда появится новая owned-сущность, ветку lookup
 * нужно будет вернуть (см. комментарий в ownership.guard.ts).
 *
 * Каждый `describe` закреплён за шагом лестницы из `ownership.guard.ts`.
 */

function makeContext(req: Record<string, unknown>): ExecutionContext {
  const http = {
    getRequest: () => req,
    getNext: () => undefined,
    getResponse: () => undefined,
  };
  return {
    switchToHttp: () => http,
    getHandler: () => () => undefined,
    getClass: () => class FakeClass {},
    getArgs: () => [] as unknown[],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as any,
    switchToWs: () => ({}) as any,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

const VALID_OBJECT_ID = '507f1f77bcf86cd799439011';
const USER_ID = '65a0000000000000000000a1';

function validUser(overrides: Partial<AuthenticatedUserLike> = {}): AuthenticatedUserLike {
  return {
    id: USER_ID,
    role: 'user',
    permissions: [],
    ...overrides,
  };
}

function makeGuard(metadata: unknown): OwnershipGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(metadata),
  } as unknown as Reflector;
  return new OwnershipGuard(reflector);
}

describe('OwnershipGuard (TZ-251 §ШАГ 2 ladder)', () => {
  describe('Step 1 — no @OwnerOnly metadata → pass-through', () => {
    it('returns true without any lookup', async () => {
      const guard = makeGuard(undefined);
      const ctx = makeContext({ user: validUser(), params: { id: VALID_OBJECT_ID } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('Step 2 — entity key not in OWNERSHIP_BY_ENTITY → pass-through', () => {
    it('returns true for an unrecognized key (defensive)', async () => {
      const guard = makeGuard('unknownEntityKey');
      const ctx = makeContext({ user: validUser(), params: { id: VALID_OBJECT_ID } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('Step 3 — shared corporate data (null ownerField) → pass-through', () => {
    it.each(['counterparty', 'product', 'material', 'category', 'organization'])(
      'returns true for %s (shared) without lookup',
      async (key) => {
        const guard = makeGuard(key);
        const ctx = makeContext({ user: validUser(), params: { id: VALID_OBJECT_ID } });
        await expect(guard.canActivate(ctx)).resolves.toBe(true);
      },
    );
  });

  describe('Step 4 — no authenticated user → 401', () => {
    it('throws UnauthorizedException when req.user is missing', async () => {
      const guard = makeGuard('photo');
      const ctx = makeContext({ params: { id: VALID_OBJECT_ID } });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when req.user.id is missing', async () => {
      const guard = makeGuard('photo');
      const ctx = makeContext({ user: { role: 'user' } as any, params: { id: VALID_OBJECT_ID } });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('Step 5 — admin wildcard → allow (OR-semantics, TZ-254-aligned)', () => {
    it('returns true when role === "admin" AND permissions includes "*"', async () => {
      const guard = makeGuard('photo');
      const ctx = makeContext({
        user: validUser({ role: 'admin', permissions: ['*'] }),
        params: { id: VALID_OBJECT_ID },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('returns true when role === "admin" but permissions array is empty (TZ-254 alignment)', async () => {
      // The seed admin has `permissions: []` and `role.name === 'admin'`.
      // The guard must accept EITHER condition as bypass (OR-semantics)
      // because the algorithm in TZ-254's `effectivePermissions` grants
      // every permission when role.name === 'admin', independent of the
      // user.permissions array contents. Previously: AND-gate would have
      // locked this user out.
      const guard = makeGuard('photo');
      const ctx = makeContext({
        user: validUser({ role: 'admin', permissions: [] }),
        params: { id: VALID_OBJECT_ID },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('returns true when permissions includes "*" but role is non-admin', async () => {
      const guard = makeGuard('photo');
      const ctx = makeContext({
        user: validUser({ role: 'manager', permissions: ['*'] }),
        params: { id: VALID_OBJECT_ID },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('REGRESSION GUARD: ordinary manager without wildcard → 404 (lookup returns null)', async () => {
      // Counterpart: ensures the OR-semantics fix did not widen the
      // bypass to non-admin/non-wildcard users. lookupDocument() has no
      // model branches post-cleanup → null → 404.
      const guard = makeGuard('photo');
      const ctx = makeContext({
        user: validUser({ role: 'manager', permissions: [] }),
        params: { id: VALID_OBJECT_ID },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('Step 6 — resource not found → 404', () => {
    it('throws NotFoundException for a non-admin requester (lookup yields null)', async () => {
      const guard = makeGuard('photo');
      const ctx = makeContext({ user: validUser(), params: { id: VALID_OBJECT_ID } });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('Step — malformed :id → 404', () => {
    it('throws NotFoundException when the path id is not a valid ObjectId', async () => {
      const guard = makeGuard('photo');
      const ctx = makeContext({
        user: validUser({ role: 'manager' }),
        params: { id: 'not-an-objectid' },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('OWNER_ONLY_KEY metadata propagation', () => {
    it('reads OWNER_ONLY_KEY (sanity: contract between decorator and guard)', () => {
      expect(OWNER_ONLY_KEY).toBe('ownerOnly');
    });
  });
});
