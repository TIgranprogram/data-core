/**
 * TZ-239 unit tests — OrgScopeGuardInterceptor + RequireOrgScope metadata.
 *
 * Notes:
 * - Tests inspect the *body* of filterValue / belongsToOrg in isolation.
 * - The factory `OrgScopeInterceptorFor()` is verified to return a
 *   stable Di-instantiable class.
 * - Mongo harness is NOT used here; this is a pure unit test.
 */
import { Reflector } from '@nestjs/core';
import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { firstValueFrom, of } from 'rxjs';
import {
  BoundOrgScopeInterceptor,
  OrgScopeGuardInterceptor,
  OrgScopeInterceptorFor,
} from './org-scope.interceptor';

const callHandler = <T>(value: T) => ({ handle: () => of(value) });

describe('OrgScopeGuardInterceptor', () => {
  let interceptor: OrgScopeGuardInterceptor;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new OrgScopeGuardInterceptor(reflector);
  });

  function buildCtx(opts: {
    hasMetadata?: boolean;
    user?: { id: string; organizationId?: string | null };
  }): ExecutionContext {
    const handler = opts.hasMetadata
      ? function orgScoped() { /* marker */ }
      : function plain() { /* marker */ };
    if (opts.hasMetadata) Reflect.defineMetadata('requireOrgScope', true, handler);
    return {
      getHandler: () => handler,
      getClass: () => class FakeController {},
      switchToHttp: () => ({
        getRequest: () => ({ user: opts.user }),
      }),
    } as unknown as ExecutionContext;
  }

  it('passes through when no @RequireOrgScope metadata is present', async () => {
    const ctx = buildCtx({ hasMetadata: false, user: { id: 'u1', organizationId: 'orgA' } });
    const value = await firstValueFrom(
      interceptor.intercept(ctx, callHandler({ organizationId: 'orgB' })),
    );
    expect(value).toEqual({ organizationId: 'orgB' });
  });

  it('bypasses filter for system user (no organizationId)', async () => {
    const ctx = buildCtx({ hasMetadata: true, user: { id: 'admin', organizationId: null } });
    const value = await firstValueFrom(
      interceptor.intercept(ctx, callHandler({ organizationId: 'any-org' })),
    );
    expect(value).toEqual({ organizationId: 'any-org' });
  });

  it('returns single doc when it matches user org', async () => {
    const ctx = buildCtx({ hasMetadata: true, user: { id: 'u1', organizationId: 'orgA' } });
    const value = await firstValueFrom(
      interceptor.intercept(ctx, callHandler({ organizationId: 'orgA', name: 'Contract-A' })),
    );
    expect(value).toEqual({ organizationId: 'orgA', name: 'Contract-A' });
  });

  it('throws NotFoundException when single doc belongs to other org', async () => {
    const ctx = buildCtx({ hasMetadata: true, user: { id: 'u1', organizationId: 'orgA' } });
    await expect(
      firstValueFrom(interceptor.intercept(ctx, callHandler({ organizationId: 'orgB' }))),
    ).rejects.toThrow(NotFoundException);
  });

  it('passes through global / system docs (organizationId null)', async () => {
    const ctx = buildCtx({ hasMetadata: true, user: { id: 'u1', organizationId: 'orgA' } });
    const value = await firstValueFrom(
      interceptor.intercept(ctx, callHandler({ organizationId: null, name: 'Shared' })),
    );
    expect(value).toEqual({ organizationId: null, name: 'Shared' });
  });

  it('filters array keeping only matching org docs', async () => {
    const ctx = buildCtx({ hasMetadata: true, user: { id: 'u1', organizationId: 'orgA' } });
    const docs = [
      { organizationId: 'orgA', name: 'A1' },
      { organizationId: 'orgB', name: 'B1' },
      { organizationId: 'orgA', name: 'A2' },
      { organizationId: null, name: 'Shared' },
    ];
    const value = await firstValueFrom(
      interceptor.intercept(ctx, callHandler(docs)),
    );
    expect(value).toEqual([
      { organizationId: 'orgA', name: 'A1' },
      { organizationId: 'orgA', name: 'A2' },
      { organizationId: null, name: 'Shared' },
    ]);
  });

  it('filters array when organizationId is populated (mongoose .populate())', async () => {
    const ctx = buildCtx({ hasMetadata: true, user: { id: 'u1', organizationId: 'orgA' } });
    const docs = [
      { organizationId: { _id: 'orgA', name: 'Org A' }, name: 'T1' },
      { organizationId: { _id: 'orgB', name: 'Org B' }, name: 'T2' },
    ];
    const value = await firstValueFrom(
      interceptor.intercept(ctx, callHandler(docs)),
    );
    expect(value).toEqual([
      { organizationId: { _id: 'orgA', name: 'Org A' }, name: 'T1' },
    ]);
  });

  it('passes through non-document values (boolean / plain object)', async () => {
    const ctx = buildCtx({ hasMetadata: true, user: { id: 'u1', organizationId: 'orgA' } });
    const value1 = await firstValueFrom(
      interceptor.intercept(ctx, callHandler(true)),
    );
    const value2 = await firstValueFrom(
      interceptor.intercept(ctx, callHandler({ status: 'ok' })),
    );
    expect(value1).toBe(true);
    expect(value2).toEqual({ status: 'ok' });
  });

  it('passes through primitive non-document value via safe path', async () => {
    // The belongsToOrg method short-circuits on non-objects. We exercise
    // that branch by sending a primitive through filterValue directly.
    const ctx = buildCtx({ hasMetadata: true, user: { id: 'u1', organizationId: 'orgA' } });
    const value = await firstValueFrom(
      interceptor.intercept(ctx, callHandler(42 as unknown)),
    );
    expect(value).toBe(42);
  });
});

describe('OrgScopeInterceptorFor', () => {
  it('returns the stable BoundOrgScopeInterceptor class', () => {
    const BoundClass = OrgScopeInterceptorFor();
    expect(BoundClass).toBe(BoundOrgScopeInterceptor);
  });

  it('NestJS DI can instantiate BoundOrgScopeInterceptor with Reflector', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        Reflector,
        BoundOrgScopeInterceptor,
      ],
    }).compile();

    const instance = moduleRef.get(BoundOrgScopeInterceptor);
    expect(instance).toBeInstanceOf(OrgScopeGuardInterceptor);
    expect(typeof instance.intercept).toBe('function');
  });
});
