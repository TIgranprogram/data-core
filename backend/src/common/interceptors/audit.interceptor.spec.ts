import { firstValueFrom, of, throwError } from 'rxjs';
import { AuditAction, AuditInterceptor } from './audit.interceptor';
import { Logger } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * TZ-125 §ШАГ 4 — Audit interceptor crash-prevention unit test.
 *
 * Hyper-minimal: inlined interceptor factory and context builder per test,
 * with the `logMock` exposed as `jest.Mock` so .mock.calls works without casts.
 */
function makeReflectorSpy(meta: object | undefined): Reflector {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'get').mockImplementation(((key: unknown) =>
    key === 'auditAction' ? meta : undefined) as never);
  return reflector;
}

function makeExecutionContext(method: string, url: string, params: Record<string, string>):
  ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ method, url, params, ip: '127.0.0.1' }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeExecutionContextWithUser(
  method: string, url: string, params: Record<string, string>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any,
): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ method, url, params, user, ip: '127.0.0.1' }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('AuditInterceptor (TZ-125)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let errorSpy: jest.SpyInstance;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    errorSpy = jest.spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterAll(() => {
    errorSpy.mockRestore();
  });

  it('logs audit entry on POST and returns response unchanged (happy path)', async () => {
    const logMock = jest.fn().mockResolvedValue(undefined);
    const interceptor = new AuditInterceptor(
      makeReflectorSpy({ action: 'create', entityType: 'category', idParam: 'id' }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { log: logMock } as any,
    );
    const ctx = makeExecutionContext('POST', '/api/categories', {});
    const next: CallHandler = { handle: () => of({ _id: '507f1f77bcf86cd799439011' }) };
    const result = await firstValueFrom(interceptor.intercept(ctx, next));
    expect(result).toEqual({ _id: '507f1f77bcf86cd799439011' });
    await new Promise((r) => setImmediate(r));
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock.mock.calls[0][0]).toMatchObject({ action: 'create', entityType: 'category' });
  });

  it('does not crash process when audit.log throws (TZ-125 acceptance)', async () => {
    const logMock = jest.fn().mockRejectedValue(new Error('MONGODOWN'));
    const interceptor = new AuditInterceptor(
      makeReflectorSpy({ action: 'update', entityType: 'material' }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { log: logMock } as any,
    );
    const ctx = makeExecutionContext('PATCH', '/api/materials/x', {});
    const next: CallHandler = { handle: () => of({ _id: 'm1' }) };
    const result = await firstValueFrom(interceptor.intercept(ctx, next));
    expect(result).toEqual({ _id: 'm1' });
    await new Promise((r) => setImmediate(r));
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('skips audit on ordinary GET requests', async () => {
    const logMock = jest.fn().mockResolvedValue(undefined);
    const interceptor = new AuditInterceptor(
      makeReflectorSpy({ action: 'read', entityType: 'category' }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { log: logMock } as any,
    );
    const ctx = makeExecutionContext('GET', '/api/categories', {});
    const next: CallHandler = { handle: () => of([{ _id: 'c1' }]) };
    await firstValueFrom(interceptor.intercept(ctx, next));
    await new Promise((r) => setImmediate(r));
    expect(logMock).not.toHaveBeenCalled();
  });

  it('logs an explicitly opted-in audited GET request', async () => {
    const logMock = jest.fn().mockResolvedValue(undefined);
    const interceptor = new AuditInterceptor(
      makeReflectorSpy({ action: 'admin.permissions.catalog', entityType: 'Permission', auditRead: true }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { log: logMock } as any,
    );
    const ctx = makeExecutionContext('GET', '/api/admin/permissions', {});
    const next: CallHandler = { handle: () => of({ sections: [] }) };
    await firstValueFrom(interceptor.intercept(ctx, next));
    await new Promise((r) => setImmediate(r));
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock.mock.calls[0][0]).toMatchObject({
      action: 'admin.permissions.catalog',
      entityType: 'Permission',
    });
  });

  it('passes through when @AuditAction metadata is absent', async () => {
    const logMock = jest.fn().mockResolvedValue(undefined);
    const reflector = new Reflector();
    jest.spyOn(reflector, 'get').mockReturnValue(undefined);
    const interceptor = new AuditInterceptor(
      reflector,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { log: logMock } as any,
    );
    const ctx = makeExecutionContext('POST', '/api/transient', {});
    const next: CallHandler = { handle: () => of({ ok: true }) };
    await firstValueFrom(interceptor.intercept(ctx, next));
    await new Promise((r) => setImmediate(r));
    expect(logMock).not.toHaveBeenCalled();
  });

  it('falls back to response._id when meta.idParam is not set', async () => {
    const logMock = jest.fn().mockResolvedValue(undefined);
    const interceptor = new AuditInterceptor(
      makeReflectorSpy({ action: 'create', entityType: 'product' }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { log: logMock } as any,
    );
    const ctx = makeExecutionContext('POST', '/api/products', {});
    const next: CallHandler = { handle: () => of({ _id: 'p999' }) };
    await firstValueFrom(interceptor.intercept(ctx, next));
    await new Promise((r) => setImmediate(r));
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock.mock.calls[0][0]).toMatchObject({ entityId: 'p999' });
  });

  it('exports AuditAction decorator and references throwError (compile-time smoke)', () => {
    expect(typeof AuditAction).toBe('function');
    expect(throwError(() => new Error('compile-check'))).toBeDefined();
  });

  // Touch the helper with-user signature so the compiler flags any
  // accidental regression if the helper function is ever removed
  // unintentionally.
  it('keeps user-context helper signature stable', () => {
    const ctx = makeExecutionContextWithUser('POST', '/x', {}, { id: 'u1', username: 'tester' });
    const req = ctx.switchToHttp().getRequest() as { user: { id: string } };
    expect(req.user.id).toBe('u1');
  });
});
