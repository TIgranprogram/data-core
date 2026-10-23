import {
  canSeeMoney,
  effectiveRoles,
  MONEY_FIELDS,
  MONEY_ROLES,
  ROLE_INHERITS,
} from './roles-hierarchy';

describe('roles-hierarchy (иерархия ролей и доступ к деньгам)', () => {
  describe('effectiveRoles', () => {
    it('пустая роль -> пустой список', () => {
      expect(effectiveRoles(undefined)).toEqual([]);
      expect(effectiveRoles(null)).toEqual([]);
      expect(effectiveRoles('')).toEqual([]);
    });

    it('неизвестная роль наследует только себя', () => {
      expect(effectiveRoles('guest')).toEqual(['guest']);
    });

    it('наблюдатель (user) не наследует ничего', () => {
      expect(effectiveRoles('user')).toEqual(['user']);
    });

    it('менеджер = менеджер + наблюдатель', () => {
      expect(effectiveRoles('manager')).toEqual(['manager', 'user']);
    });

    it('директор включает бухгалтера, менеджера и наблюдателя, но не admin', () => {
      const r = effectiveRoles('director');
      expect(r).toEqual(['director', 'accountant', 'manager', 'user']);
      expect(r).not.toContain('admin');
    });

    it('admin включает все роли', () => {
      expect(effectiveRoles('admin')).toEqual(
        expect.arrayContaining(['admin', 'director', 'accountant', 'manager', 'user']),
      );
    });

    it('младшая роль никогда не получает старшую', () => {
      for (const [role, inherited] of Object.entries(ROLE_INHERITS)) {
        for (const lower of inherited) {
          expect(effectiveRoles(lower)).not.toContain(role);
        }
      }
    });
  });

  describe('canSeeMoney', () => {
    it.each(MONEY_ROLES)('роль %s видит деньги', (role) => {
      expect(canSeeMoney({ role })).toBe(true);
    });

    it.each(['manager', 'user', 'guest'])('роль %s деньги не видит', (role) => {
      expect(canSeeMoney({ role })).toBe(false);
    });

    it('владелец видит деньги независимо от роли', () => {
      expect(canSeeMoney({ role: 'user', isOwner: true })).toBe(true);
    });

    it('isOwner: false не даёт обхода', () => {
      expect(canSeeMoney({ role: 'user', isOwner: false })).toBe(false);
    });

    it('нет пользователя / нет роли -> нельзя', () => {
      expect(canSeeMoney(undefined)).toBe(false);
      expect(canSeeMoney(null)).toBe(false);
      expect(canSeeMoney({})).toBe(false);
      expect(canSeeMoney({ role: null })).toBe(false);
    });
  });

  it('MONEY_FIELDS содержит основные денежные поля', () => {
    expect(MONEY_FIELDS).toEqual(
      expect.arrayContaining(['amount', 'paidAmount', 'unitPrice', 'sum']),
    );
  });
});
