import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DICTS } from './dicts.defs';
import { hideContacts, hideLogin } from './dicts.payroll';
import { canLinkLogin, loginBody, resolveLogin } from './dicts.person-login';

const oid = () => new Types.ObjectId();
const persons = DICTS.find((d) => d.key === 'persons')!;

/** Память вместо Mongo: пользователи и сотрудники; `findOne` понимает только нужные фильтры. */
function fake(users: Array<Record<string, unknown>>, people: Array<Record<string, unknown>>) {
  return {
    collection: (name: string) => ({
      findOne: async (f: Record<string, unknown>) => {
        if (name === 'users') return users.find((u) => String(u._id) === String(f._id)) ?? null;
        const ne = (f._id as { $ne?: unknown } | undefined)?.$ne;
        return people.find((p) => (f.userId ? String(p.userId) === String(f.userId) : String(p._id) === String(f._id)) && (!ne || String(p._id) !== String(ne)) && (f.status === undefined || p.status === f.status)) ?? null;
      },
    }),
  } as never;
}
const label = (d: Record<string, unknown>) => [d.lastName, d.firstName].filter(Boolean).join(' ');

describe('сотрудник: «Вход в приложение» (C050)', () => {
  const uid = oid(), self = oid();

  it('привязывать вход могут только администратор и директор', () => {
    expect(canLinkLogin({ role: 'admin' })).toBe(true);
    expect(canLinkLogin({ role: 'director' })).toBe(true);
    expect(canLinkLogin({ role: 'manager' })).toBe(false);
    expect(canLinkLogin({ role: 'user' })).toBe(false);
    expect(canLinkLogin(undefined)).toBe(false);
  });

  it('у менеджера поле userId из тела запроса убирается, у директора остаётся', () => {
    expect(loginBody({ role: 'manager' }, { userId: 'x', phone: '1' })).toEqual({ phone: '1' });
    expect(loginBody({ role: 'director' }, { userId: 'x' })).toEqual({ userId: 'x' });
  });

  it('вход занят другим сотрудником — 409 «Этот вход уже привязан к <ФИО>»', async () => {
    const db = fake([{ _id: uid }], [{ _id: oid(), userId: uid, lastName: 'Петров', firstName: 'Иван' }]);
    await expect(resolveLogin(db, String(uid), String(self), label)).rejects.toThrow(new ConflictException('Этот вход уже привязан к Петров Иван'));
  });

  it('свой же вход при повторном сохранении — не конфликт; пусто — снять связь', async () => {
    const db = fake([{ _id: uid }], [{ _id: self, userId: uid, lastName: 'Петров', firstName: 'Иван' }]);
    expect(String(await resolveLogin(db, String(uid), String(self), label))).toBe(String(uid));
    expect(await resolveLogin(db, '', String(self), label)).toBeNull();
    expect(await resolveLogin(db, null, String(self), label)).toBeNull();
  });

  it('несуществующий вход — 400', async () => {
    await expect(resolveLogin(fake([], []), String(oid()), undefined, label)).rejects.toBeInstanceOf(BadRequestException);
    await expect(resolveLogin(fake([], []), 'не-id', undefined, label)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('справочник: уволенному вход стирается; без поля userId запись его не трогает', async () => {
    const db = fake([{ _id: uid }], []);
    const fired = await persons.toDoc({ firstName: 'Иван', status: 'fired' }, false, db, String(self));
    expect(fired.userId).toBeNull();
    const firedWithLogin = await persons.toDoc({ status: 'fired', userId: String(uid) }, false, db, String(self));
    expect(firedWithLogin.userId).toBeNull();
    const plain = await persons.toDoc({ phone: '+7 900' }, false, db, String(self));
    expect(plain).not.toHaveProperty('userId');
    const linked = await persons.toDoc({ userId: String(uid) }, false, db, String(self));
    expect(String(linked.userId)).toBe(String(uid));
  });

  it('уволенному вход не привязывают, если статус уже «Уволен»', async () => {
    const db = fake([{ _id: uid }], [{ _id: self, status: 'fired' }]);
    await expect(persons.toDoc({ userId: String(uid) }, false, db, String(self))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('удалённый сотрудник теряет вход (softDelete), строка отдаёт userId', () => {
    expect(persons.softDelete).toEqual({ userId: null });
    expect(persons.row({ _id: self, userId: uid, firstName: 'И' } as never).userId).toBe(String(uid));
    expect(persons.row({ _id: self, firstName: 'И' } as never).userId).toBe('');
  });

  it('ответ без права: вход и контакты спрятаны в строках, форме и списке входов', () => {
    const res = { items: [{ name: 'Иван', phone: '1', email: 'a@b', userId: 'u', userName: 'ivan', position: 'Сварщик' }], dict: { fields: [{ key: 'phone' }, { key: 'userId' }, { key: 'position' }], refs: { users: [{ value: 'u', label: 'ivan' }], worktypes: [] } } };
    const noLogin = hideLogin(res) as typeof res;
    expect(noLogin.items[0]).toEqual({ name: 'Иван', phone: '1', email: 'a@b', position: 'Сварщик' });
    expect(noLogin.dict.fields.map((f) => f.key)).toEqual(['phone', 'position']);
    expect(noLogin.dict.refs).not.toHaveProperty('users');
    const noContacts = hideContacts(res) as typeof res;
    expect(noContacts.items[0]).toEqual({ name: 'Иван', userId: 'u', userName: 'ivan', position: 'Сварщик' });
  });
});
