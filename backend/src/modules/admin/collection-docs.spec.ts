import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { buildDocsFilter, MASK, parseDocsQuery, sanitizeValue } from './collection-docs';

describe('collection-docs (A2: просмотр записей)', () => {
  it('секреты маскируются на любой глубине, служебные version/prefix — нет', () => {
    const out = sanitizeValue({
      username: 'admin',
      passwordHash: '$2a$10$abc',
      refreshTokenVersion: 3,
      tokenPrefix: 'kppd_ab',
      nested: { apiKey: 'xyz', ok: 1 },
      list: [{ secret: 's' }],
      emptyToken: '',
    }) as Record<string, any>;
    expect(out.passwordHash).toBe(MASK);
    expect(out.nested.apiKey).toBe(MASK);
    expect(out.list[0].secret).toBe(MASK);
    expect(out.refreshTokenVersion).toBe(3);
    expect(out.tokenPrefix).toBe('kppd_ab');
    expect(out.emptyToken).toBe('');
    expect(out.nested.ok).toBe(1);
  });

  it('ObjectId и Date → строки, длинное обрезается', () => {
    const id = new Types.ObjectId();
    const d = new Date('2026-10-18T10:00:00Z');
    const out = sanitizeValue({ _id: id, at: d, big: 'x'.repeat(3000), arr: Array.from({ length: 150 }, (_, i) => i) }) as Record<string, any>;
    expect(out._id).toBe(id.toHexString());
    expect(out.at).toBe('2026-10-18T10:00:00.000Z');
    expect(out.big.length).toBe(2001);
    expect(out.arr).toHaveLength(101);
    expect(out.arr[100]).toBe('… ещё 50');
  });

  it('параметры: значения по умолчанию, предел limit, ошибки', () => {
    expect(parseDocsQuery({})).toEqual({ page: 1, limit: 20, deleted: 'exclude', q: '' });
    expect(parseDocsQuery({ limit: '500' }).limit).toBe(100);
    expect(() => parseDocsQuery({ page: '0' })).toThrow(BadRequestException);
    expect(() => parseDocsQuery({ deleted: 'all' })).toThrow(BadRequestException);
  });

  it('фильтр: удалённые, поиск по id и по тексту (спецсимволы экранируются)', () => {
    expect(buildDocsFilter(parseDocsQuery({}))).toEqual({ deletedAt: null });
    expect(buildDocsFilter(parseDocsQuery({ deleted: 'include' }))).toEqual({});
    expect(buildDocsFilter(parseDocsQuery({ deleted: 'only' }))).toEqual({ deletedAt: { $ne: null } });
    const id = new Types.ObjectId().toHexString();
    const byId = buildDocsFilter(parseDocsQuery({ deleted: 'include', q: id })) as { _id: Types.ObjectId };
    expect(byId._id.toHexString()).toBe(id);
    const byText = buildDocsFilter(parseDocsQuery({ q: 'a.b' })) as { $and: Array<Record<string, any>> };
    expect(byText.$and[1].$or[0].name.$regex).toBe('a\\.b');
  });
});
