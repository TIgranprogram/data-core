import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  MAX_DOC_BYTES,
  MAX_LIMIT,
  mongoCollectionName,
  parseFilter,
  assertAppName,
  parseMongoCollectionName,
  parseObjectId,
  parsePagination,
  parseSort,
  sanitizeDocument,
} from './app-data.validation';
import { allowedApps, AppScopeGuard } from './app-scope.guard';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';

describe('app-data validation (P1)', () => {
  describe('имена', () => {
    it.each([
      ['notes', 'items', 'app_notes_items'],
      ['budget2', 'order_items', 'app_budget2_order_items'],
      ['a', 'b', 'app_a_b'],
    ])('%s/%s → %s', (app, coll, expected) => {
      expect(mongoCollectionName(app, coll)).toBe(expected);
      expect(parseMongoCollectionName(expected)).toEqual({ app, collection: coll });
    });

    it.each(['', 'Notes', '1app', 'my_app', 'my-app', 'a'.repeat(41), 'app.x', 'app$'])(
      'приложение «%s» → 400',
      (app) => {
        expect(() => mongoCollectionName(app, 'items')).toThrow(BadRequestException);
      },
    );

    it.each(['', 'Items', '_x', '1x', 'x-y', 'x.y', 'x$', 'a'.repeat(41), 'system'.toUpperCase()])(
      'коллекция «%s» → 400',
      (coll) => {
        expect(() => mongoCollectionName('notes', coll)).toThrow(BadRequestException);
      },
    );

    it('принимает 40 символов', () => {
      expect(() => mongoCollectionName('a'.repeat(40), 'b'.repeat(40))).not.toThrow();
    });

    it('служебное приложение control закрыто', () => {
      expect(() => assertAppName('control')).toThrow(BadRequestException);
      expect(parseMongoCollectionName('app_control_daily')).toBeNull();
    });

    it('parseMongoCollectionName игнорирует чужие имена', () => {
      expect(parseMongoCollectionName('users')).toBeNull();
      expect(parseMongoCollectionName('app_')).toBeNull();
      expect(parseMongoCollectionName('app_notes')).toBeNull();
      expect(parseMongoCollectionName('app__x')).toBeNull();
    });
  });

  describe('parseObjectId', () => {
    it('валидный hex → ObjectId', () => {
      const id = new Types.ObjectId().toHexString();
      expect(parseObjectId(id).toHexString()).toBe(id);
    });
    it.each(['', 'abc', 'zzzzzzzzzzzzzzzzzzzzzzzz', '1'.repeat(25)])('«%s» → 400', (id) => {
      expect(() => parseObjectId(id)).toThrow(BadRequestException);
    });
  });

  describe('sanitizeDocument', () => {
    it('отбрасывает служебные поля', () => {
      const out = sanitizeDocument({
        title: 'x',
        _id: 'a',
        id: 'b',
        createdAt: 1,
        updatedAt: 2,
        createdBy: 3,
        updatedBy: 4,
        deletedAt: 5,
      });
      expect(out).toEqual({ title: 'x' });
    });

    it('сохраняет вложенные объекты и массивы', () => {
      const doc = { a: { b: [1, { c: 'd' }] }, n: null, t: true };
      expect(sanitizeDocument(doc)).toEqual(doc);
    });

    it.each([
      [{ $set: { a: 1 } }],
      [{ 'a.b': 1 }],
      [{ a: { $gt: 1 } }],
      [{ a: [{ ok: 1 }, { 'x.y': 2 }] }],
      [{ a: { b$: 1 } }],
      [{ '': 1 }],
    ])('ключи с $ или . → 400: %j', (doc) => {
      expect(() => sanitizeDocument(doc)).toThrow(BadRequestException);
    });

    it.each([[null], [[1, 2]], ['str'], [42]])('не объект → 400: %j', (body) => {
      expect(() => sanitizeDocument(body)).toThrow(BadRequestException);
    });

    it('слишком глубокая вложенность → 400', () => {
      let deep: Record<string, unknown> = { v: 1 };
      for (let i = 0; i < 40; i++) deep = { n: deep };
      expect(() => sanitizeDocument(deep)).toThrow(BadRequestException);
    });

    it('больше 256 КБ → 413', () => {
      expect(() => sanitizeDocument({ big: 'x'.repeat(MAX_DOC_BYTES) })).toThrow(PayloadTooLargeException);
      expect(() => sanitizeDocument({ ok: 'x'.repeat(MAX_DOC_BYTES - 100) })).not.toThrow();
    });
  });

  describe('parseFilter', () => {
    it('пусто → {}', () => {
      expect(parseFilter(undefined)).toEqual({});
      expect(parseFilter('')).toEqual({});
    });

    it('равенство и разрешённые операторы', () => {
      const f = parseFilter(
        JSON.stringify({
          status: 'open',
          qty: { $gte: 1, $lt: 10 },
          tag: { $in: ['a', 'b'] },
          other: { $nin: [1] },
          gone: { $exists: false },
          x: { $eq: 1, $ne: 2, $gt: 0, $lte: 5 },
          'address.city': 'Москва',
        }),
      );
      expect(f).toEqual({
        status: 'open',
        qty: { $gte: 1, $lt: 10 },
        tag: { $in: ['a', 'b'] },
        other: { $nin: [1] },
        gone: { $exists: false },
        x: { $eq: 1, $ne: 2, $gt: 0, $lte: 5 },
        'address.city': 'Москва',
      });
    });

    it('id → _id как ObjectId', () => {
      const hex = new Types.ObjectId().toHexString();
      const f = parseFilter(JSON.stringify({ id: hex }));
      expect(f._id).toBeInstanceOf(Types.ObjectId);
      const g = parseFilter(JSON.stringify({ _id: { $in: [hex] } })) as { _id: { $in: Types.ObjectId[] } };
      expect(g._id.$in[0]).toBeInstanceOf(Types.ObjectId);
    });

    it('createdAt из ISO-строки → Date', () => {
      const f = parseFilter(JSON.stringify({ createdAt: { $gte: '2026-01-01T00:00:00Z' } })) as {
        createdAt: { $gte: Date };
      };
      expect(f.createdAt.$gte).toBeInstanceOf(Date);
      expect(() => parseFilter(JSON.stringify({ createdAt: 'не дата' }))).toThrow(BadRequestException);
    });

    it.each([
      { $where: 'sleep(1000)' },
      { $expr: { $gt: ['$a', 1] } },
      { $or: [{ a: 1 }] },
      { $and: [{ a: 1 }] },
      { a: { $where: '1' } },
      { a: { $regex: '^x' } },
      { a: { $function: {} } },
      { a: { $elemMatch: { b: 1 } } },
      { a: { $gt: 1, $regex: 'x' } },
      { a: { $eq: { $where: '1' } } },
      { a: { $in: [{ $gt: 1 }] } },
      { a: { b: { $gt: 1 } } },
      { a: { $in: 'not-array' } },
      { a: { $exists: 'yes' } },
      { 'a$b': 1 },
      { 'bad field': 1 },
    ])('запрещено → 400: %j', (f) => {
      expect(() => parseFilter(JSON.stringify(f))).toThrow(BadRequestException);
    });

    it.each(['{', '[1]', '"x"', '1', 'null'])('не JSON-объект → 400: %s', (raw) => {
      expect(() => parseFilter(raw)).toThrow(BadRequestException);
    });
  });

  describe('parseSort', () => {
    it('по умолчанию _id', () => {
      expect(parseSort(undefined)).toEqual({ _id: 1 });
    });
    it('field, -field, несколько, id → _id', () => {
      expect(parseSort('-qty,name')).toEqual({ qty: -1, name: 1, _id: 1 });
      expect(parseSort('-id')).toEqual({ _id: -1 });
      expect(parseSort('a.b')).toEqual({ 'a.b': 1, _id: 1 });
    });
    it.each(['$natural', '-', 'a b', 'a,,b', '{"a":1}'])('«%s» → 400', (s) => {
      expect(() => parseSort(s)).toThrow(BadRequestException);
    });
  });

  describe('parsePagination', () => {
    it('по умолчанию 1/50', () => {
      expect(parsePagination()).toEqual({ page: 1, limit: 50 });
    });
    it(`limit урезается до ${MAX_LIMIT}`, () => {
      expect(parsePagination('3', '1000')).toEqual({ page: 3, limit: MAX_LIMIT });
    });
    it.each([['0', '10'], ['1', '0'], ['-1', '10'], ['x', '10'], ['1', '2.5']])('page=%s limit=%s → 400', (p, l) => {
      expect(() => parsePagination(p, l)).toThrow(BadRequestException);
    });
  });
});

describe('AppScopeGuard (P1 × P2)', () => {
  const guard = new AppScopeGuard();
  const ctx = (user: unknown, params: Record<string, string>) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user, params }) }) }) as unknown as ExecutionContext;

  it('без keyScope — пропускает', () => {
    expect(guard.canActivate(ctx({ id: 'u', role: 'user' }, { app: 'notes' }))).toBe(true);
    expect(allowedApps({ id: 'u', role: 'user' })).toBeNull();
  });

  it('keyScope без apps — пропускает', () => {
    expect(guard.canActivate(ctx({ id: 'u', role: 'user', keyScope: { access: 'read' } }, { app: 'notes' }))).toBe(true);
  });

  it('app в списке — пропускает, не в списке — 403', () => {
    const user = { id: 'u', role: 'user', keyScope: { access: 'full' as const, apps: ['notes'] } };
    expect(guard.canActivate(ctx(user, { app: 'notes' }))).toBe(true);
    expect(() => guard.canActivate(ctx(user, { app: 'budget' }))).toThrow(ForbiddenException);
  });

  it('пустой список приложений — запрещает любое', () => {
    const user = { id: 'u', role: 'user', keyScope: { access: 'full', apps: [] } };
    expect(() => guard.canActivate(ctx(user, { app: 'notes' }))).toThrow(ForbiddenException);
  });

  it('маршрут без :app (GET /apps) — пропускает (список сужается в сервисе)', () => {
    const user = { id: 'u', role: 'user', keyScope: { access: 'full' as const, apps: ['notes'] } };
    expect(guard.canActivate(ctx(user, {}))).toBe(true);
    expect(allowedApps(user)).toEqual(['notes']);
  });
});

describe('согласованность имени приложения с правами ключа (P1↔P2)', () => {
  it('KEY_SCOPE_APP_RE совпадает с APP_NAME_RE', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { KEY_SCOPE_APP_RE } = require('../../common/guards/key-scope');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { APP_NAME_RE } = require('./app-data.validation');
    expect(KEY_SCOPE_APP_RE.source).toBe(APP_NAME_RE.source);
  });
});
