import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfirmTokenGuard } from './confirm-token.guard';
import { signConfirmToken } from '../confirm-token';

const ctx = (user: unknown, headers: Record<string, unknown> = {}) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user, headers }) }) }) as unknown as ExecutionContext;

describe('ConfirmTokenGuard', () => {
  const guard = new ConfirmTokenGuard();
  beforeAll(() => { process.env.JWT_SECRET = 'test-secret'; });

  it('admin и машинный ключ — без токена', () => {
    expect(guard.canActivate(ctx({ id: 'a', role: 'admin' }))).toBe(true);
    expect(guard.canActivate(ctx({ id: 'k', role: 'user', keyScope: 'x' }))).toBe(true);
  });
  it('manager без токена → 403 CONFIRM_REQUIRED', () => {
    expect(() => guard.canActivate(ctx({ id: 'm', role: 'manager' }))).toThrow(ForbiddenException);
  });
  it('manager с верным токеном — пускает', () => {
    expect(guard.canActivate(ctx({ id: 'm', role: 'manager' }, { 'x-confirm-token': signConfirmToken('m') }))).toBe(true);
  });
  it('чужой и истёкший токен → 403', () => {
    expect(() => guard.canActivate(ctx({ id: 'm', role: 'manager' }, { 'x-confirm-token': signConfirmToken('other') }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx({ id: 'm', role: 'manager' }, { 'x-confirm-token': signConfirmToken('m', Date.now() - 10 * 60 * 1000) }))).toThrow(ForbiddenException);
  });
});
