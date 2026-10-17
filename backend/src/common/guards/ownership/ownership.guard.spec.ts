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
 * The model is mocked with a query chain that supports BOTH
 *   - `findById(id).exec()`                  (terminating call)
 *   - `findById(id).lean().exec()`           (chained: lean returns new query, then exec)
 *
 * because the real `OwnershipGuard.lookupDocument()` uses the second form
 * to coerce Mongoose into returning POJOs (avoids hydration overhead).
 *
 * Each `describe` block corresponds to one step in the ladder documented
 * in `ownership.guard.ts`. The test name pins the step so a regression
 * points at the specific ladder step in the failure message.
 */

type LeanDoc = Record<string, unknown> | null;

/**
 * Build a query-mock that exposes both `exec()` and `lean().exec()`.
 * Real Mongoose Query has both methods on the same instance and they
 * are interchangeable when `lean()` is called. Mirror that here so
 * tests pass regardless of which call shape the guard picks.
 */
function buildModelMock(resolvedValue: LeanDoc) {
  // The Promise resolved by both .exec() and .lean().exec()
  const exec = jest.fn().mockResolvedValue(resolvedValue);
  // .lean() returns a NEW object that also has .exec() (Mongoose semantics)
  const lean = jest.fn().mockImplementation(
    () => ({ exec }),
  );
  // Both methods are present on the same query object so either call
  // pattern works.
  const findById = jest.fn().mockReturnValue({ exec, lean });
  return { findById, exec, lean };
}

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

describe('OwnershipGuard (TZ-251 §ШАГ 2 ladder)', () => {
  describe('Step 1 — no @OwnerOnly metadata → pass-through', () => {
    it('returns true without consulting the model', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(undefined),
      } as unknown as Reflector;
      const model = buildModelMock(null);
      const guard = new OwnershipGuard(reflector, model as any);
      const ctx = makeContext({ user: validUser(), params: { id: VALID_OBJECT_ID } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(model.findById).not.toHaveBeenCalled();
    });
  });

  describe('Step 2 — entity key not in OWNERSHIP_BY_ENTITY → pass-through', () => {
    it('returns true for an unrecognized key (defensive)', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue('unknownEntityKey'),
      } as unknown as Reflector;
      const model = buildModelMock(null);
      const guard = new OwnershipGuard(reflector, model as any);
      const ctx = makeContext({ user: validUser(), params: { id: VALID_OBJECT_ID } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(model.findById).not.toHaveBeenCalled();
    });
  });

  describe('Step 3 — shared corporate data (null ownerField) → pass-through', () => {
    it('returns true for counterparty (shared) without consulting model', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue('counterparty'),
      } as unknown as Reflector;
      const model = buildModelMock(null);
      const guard = new OwnershipGuard(reflector, model as any);
      const ctx = makeContext({ user: validUser(), params: { id: VALID_OBJECT_ID } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(model.findById).not.toHaveBeenCalled();
    });
  });

  describe('Step 4 — no authenticated user → 401', () => {
    it('throws UnauthorizedException when req.user is missing', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue('documentTemplate'),
      } as unknown as Reflector;
      const model = buildModelMock(null);
      const guard = new OwnershipGuard(reflector, model as any);
      const ctx = makeContext({ params: { id: VALID_OBJECT_ID } });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(model.findById).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when req.user.id is missing', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue('documentTemplate'),
      } as unknown as Reflector;
      const model = buildModelMock(null);
      const guard = new OwnershipGuard(reflector, model as any);
      const ctx = makeContext({ user: { role: 'user' } as any, params: { id: VALID_OBJECT_ID } });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(model.findById).not.toHaveBeenCalled();
    });
  });

  describe('Step 5 — admin with wildcard permission → allow (OR-semantics, TZ-254-aligned)', () => {
    it('returns true when role === "admin" AND permissions includes "*"', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue('documentTemplate'),
      } as unknown as Reflector;
      const model = buildModelMock(null);
      const guard = new OwnershipGuard(reflector, model as any);
      const ctx = makeContext({
        user: validUser({ role: 'admin', permissions: ['*'] }),
        params: { id: VALID_OBJECT_ID },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(model.findById).not.toHaveBeenCalled();
    });

    it('returns true when role === "admin" but permissions array is empty (TZ-254 alignment)', async () => {
      // The seed admin has `permissions: []` and `role.name === 'admin'`.
      // The guard must accept EITHER condition as bypass (OR-semantics)
      // because the algorithm in TZ-254's `effectivePermissions` grants
      // every permission when role.name === 'admin', independent of the
      // user.permissions array contents. Previously: AND-gate would have
      // locked this user out.
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue('documentTemplate'),
      } as unknown as Reflector;
      const model = buildModelMock(null);
      const guard = new OwnershipGuard(reflector, model as any);
      const ctx = makeContext({
        user: validUser({ role: 'admin', permissions: [] }),
        params: { id: VALID_OBJECT_ID },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(model.findById).not.toHaveBeenCalled();
    });

    it('returns true when permissions includes "*" but role is non-admin', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue('documentTemplate'),
      } as unknown as Reflector;
      const model = buildModelMock(null);
      const guard = new OwnershipGuard(reflector, model as any);
      const ctx = makeContext({
        user: validUser({ role: 'manager', permissions: ['*'] }),
        params: { id: VALID_OBJECT_ID },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(model.findById).not.toHaveBeenCalled();
    });

    it('REGRESSION GUARD: ordinary manager without wildcard → 404', async () => {
      // Counterpart: ensures the OR-semantics fix did not widen the
      // bypass to non-admin/non-wildcard users.
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue('documentTemplate'),
      } as unknown as Reflector;
      const model = buildModelMock(null);
      const guard = new OwnershipGuard(reflector, model as any);
      const ctx = makeContext({
        user: validUser({ role: 'manager', permissions: [] }),
        params: { id: VALID_OBJECT_ID },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
      expect(model.findById).toHaveBeenCalled();
    });
  });

  describe('Step 6 — resource not found → 404', () => {
    it('throws NotFoundException when the document is missing', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue('documentTemplate'),
      } as unknown as Reflector;
      const model = buildModelMock(null);
      const guard = new OwnershipGuard(reflector, model as any);
      const ctx = makeContext({ user: validUser(), params: { id: VALID_OBJECT_ID } });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
      expect(model.findById).toHaveBeenCalledWith(VALID_OBJECT_ID);
    });
  });

  describe('Step 7 — legacy data, no owner column set → defer to RBAC (allow)', () => {
    it('allows a non-admin user when createdBy is undefined (backward compat)', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue('documentTemplate'),
      } as unknown as Reflector;
      const doc = { name: 'legacy template' }; // no createdBy
      const model = buildModelMock(doc);
      const guard = new OwnershipGuard(reflector, model as any);
      const ctx = makeContext({ user: validUser(), params: { id: VALID_OBJECT_ID } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('Step 8 — owner match → allow', () => {
    it('allows when ownerId.toString() equals req.user.id', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue('documentTemplate'),
      } as unknown as Reflector;
      const ownerObjectId = { toString: () => USER_ID } as any;
      const doc = { createdBy: ownerObjectId };
      const model = buildModelMock(doc);
      const guard = new OwnershipGuard(reflector, model as any);
      const ctx = makeContext({ user: validUser({ role: 'manager' }), params: { id: VALID_OBJECT_ID } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('allows when createdBy is stored as a plain string matching req.user.id', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue('documentTemplate'),
      } as unknown as Reflector;
      const doc = { createdBy: USER_ID };
      const model = buildModelMock(doc);
      const guard = new OwnershipGuard(reflector, model as any);
      const ctx = makeContext({ user: validUser({ role: 'manager' }), params: { id: VALID_OBJECT_ID } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('Step 9 — owner mismatch → 404 (no enumeration leak)', () => {
    it('throws NotFoundException, NOT ForbiddenException, when owner differs', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue('documentTemplate'),
      } as unknown as Reflector;
      const doc = { createdBy: { toString: () => '65b0000000000000000000b2' /* OTHER USER */ } as any };
      const model = buildModelMock(doc);
      const guard = new OwnershipGuard(reflector, model as any);
      const ctx = makeContext({ user: validUser({ role: 'manager' }), params: { id: VALID_OBJECT_ID } });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('Step — malformed :id → 404', () => {
    it('throws NotFoundException when the path id is not a valid ObjectId', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue('documentTemplate'),
      } as unknown as Reflector;
      const model = buildModelMock({ createdBy: USER_ID });
      const guard = new OwnershipGuard(reflector, model as any);
      const ctx = makeContext({
        user: validUser({ role: 'manager' }),
        params: { id: 'not-an-objectid' },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
      expect(model.findById).not.toHaveBeenCalled();
    });
  });

  describe('OWNER_ONLY_KEY metadata propagation', () => {
    it('reads OWNER_ONLY_KEY (sanity: contract between decorator and guard)', () => {
      expect(OWNER_ONLY_KEY).toBe('ownerOnly');
    });
  });
});

describe('buildModelMock helper — chain-shape coverage', () => {
  it('supports findById(id).exec()', async () => {
    const model = buildModelMock({ foo: 1 });
    await expect(model.findById('x').exec()).resolves.toEqual({ foo: 1 });
  });

  it('supports findById(id).lean().exec() (the shape guard uses in production)', async () => {
    const model = buildModelMock({ foo: 1 });
    await expect(model.findById('x').lean().exec()).resolves.toEqual({ foo: 1 });
  });

  it('returns null when the modeled resource is missing', async () => {
    const model = buildModelMock(null);
    await expect(model.findById('x').lean().exec()).resolves.toBeNull();
  });
});
