import { CONFIRM_TTL_SEC, signConfirmToken, verifyConfirmToken } from './confirm-token';
import { ConfirmTokenGuard } from './guards/confirm-token.guard';
import { ForbiddenException } from '@nestjs/common';

process.env.JWT_SECRET = 'x'.repeat(32);

describe('confirm-token', () => {
  it('свой токен в срок — верен', () => {
    expect(verifyConfirmToken(signConfirmToken('u1', 1000), 'u1', 1000 + 1000)).toBe(true);
  });
  it('истёк', () => {
    expect(verifyConfirmToken(signConfirmToken('u1', 0), 'u1', CONFIRM_TTL_SEC * 1000 + 1)).toBe(false);
  });
  it('чужой пользователь, подделка, мусор, нет токена', () => {
    const t = signConfirmToken('u1');
    expect(verifyConfirmToken(t, 'u2')).toBe(false);
    expect(verifyConfirmToken(t.slice(0, -2) + 'AA', 'u1')).toBe(false);
    expect(verifyConfirmToken('a.b.c', 'u1')).toBe(false);
    expect(verifyConfirmToken(undefined, 'u1')).toBe(false);
  });
});

describe('ConfirmTokenGuard', () => {
  const run = (user: object | undefined, headers: Record<string, string> = {}) =>
    new ConfirmTokenGuard().canActivate({ switchToHttp: () => ({ getRequest: () => ({ user, headers }) }) } as never);
  it('admin и ключ kppd_ — без токена', () => {
    expect(run({ id: 'a', role: 'admin' })).toBe(true);
    expect(run({ id: 'k', role: 'manager', keyScope: {} })).toBe(true);
  });
  it('manager без токена — 403, с токеном — ок', () => {
    expect(() => run({ id: 'm', role: 'manager' })).toThrow(ForbiddenException);
    expect(run({ id: 'm', role: 'manager' }, { 'x-confirm-token': signConfirmToken('m') })).toBe(true);
    expect(() => run({ id: 'm', role: 'manager' }, { 'x-confirm-token': signConfirmToken('other') })).toThrow(ForbiddenException);
  });
});
