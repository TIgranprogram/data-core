import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { MoneyAccessGuard, PayrollAccessGuard } from './guards/money-access.guard';
import { MoneyMaskInterceptor } from './interceptors/money-mask.interceptor';
import { canSeeMoney, canSeePayroll, setCustomRoleBases, setRoleMoneyAll } from './roles-hierarchy';

const ctx = (user: Record<string, unknown>, body?: Record<string, unknown>): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user, body, query: {} }) }) }) as unknown as ExecutionContext;

describe('Галочка «Деньги» роли', () => {
  beforeEach(() => {
    setCustomRoleBases([{ name: 'r-sklad1', baseRole: 'manager' }, { name: 'r-obs001', baseRole: 'user' }]);
    setRoleMoneyAll([{ name: 'manager', money: false }, { name: 'r-obs001', money: true }, { name: 'admin', money: false }, { name: 'r-sklad1' }]);
  });
  afterAll(() => { setCustomRoleBases([]); setRoleMoneyAll([]); });

  it('встроенная роль: money:false скрывает, нет поля — как раньше', () => {
    expect(canSeeMoney({ role: 'manager' })).toBe(false);
    expect(canSeeMoney({ role: 'accountant' })).toBe(true);
    expect(canSeeMoney({ role: 'user' })).toBe(false);
  });
  it('своя роль: true/нет поля', () => {
    expect(canSeeMoney({ role: 'r-obs001' })).toBe(true);
    expect(canSeeMoney({ role: 'r-sklad1' })).toBe(true); // нет поля — по baseRole manager
  });
  it('admin и владелец видят деньги даже при money:false', () => {
    expect(canSeeMoney({ role: 'admin' })).toBe(true);
    expect(canSeeMoney({ role: 'user', isOwner: true })).toBe(true);
  });
  it('ФОТ: money:false закрывает, иначе как раньше', () => {
    setRoleMoneyAll([{ name: 'accountant', money: false }]);
    expect(canSeePayroll({ role: 'accountant' })).toBe(false);
    setRoleMoneyAll([]);
    expect(canSeePayroll({ role: 'accountant' })).toBe(true);
    expect(canSeePayroll({ role: 'manager' })).toBe(false);
  });
  it('гарды разделов: 403 без денег', () => {
    expect(() => new MoneyAccessGuard().canActivate(ctx({ role: 'manager' }))).toThrow(ForbiddenException);
    expect(new MoneyAccessGuard().canActivate(ctx({ role: 'admin' }))).toBe(true);
    expect(() => new PayrollAccessGuard().canActivate(ctx({ role: 'manager' }))).toThrow(ForbiddenException);
  });
  it('маска режет цены склада/изделий; PATCH без цены ничего не затирает', async () => {
    const next = { handle: () => of({ items: [{ name: 'Болт', pricePerUnit: 5, listPrice: 9, cost: 1, qty: 3 }], total: 1 }) };
    const body: Record<string, unknown> = { name: 'Х', listPrice: 7 };
    const out = (await lastValueFrom(new MoneyMaskInterceptor().intercept(ctx({ role: 'manager' }, body), next))) as { items: Record<string, unknown>[]; total: number };
    expect(out.items[0]).toEqual({ name: 'Болт', qty: 3 });
    expect(out.total).toBe(1);
    expect(body).toEqual({ name: 'Х' });
  });
});
