import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { parseAuditQuery } from './audit-query';

describe('parseAuditQuery (A3: фильтры журнала)', () => {
  it('по умолчанию: все записи, страница 1, 50 шт.', () => {
    expect(parseAuditQuery({})).toEqual({ filter: {}, page: 1, limit: 50 });
  });

  it('фильтры по типу, действию, пользователю и записи', () => {
    const uid = new Types.ObjectId().toHexString();
    const eid = new Types.ObjectId().toHexString();
    const { filter } = parseAuditQuery({ entityType: 'User', action: 'update', userId: uid, entityId: eid });
    expect(filter.entityType).toBe('User');
    expect(filter.action).toBe('update');
    expect((filter.userId as Types.ObjectId).toHexString()).toBe(uid);
    expect((filter.entityId as Types.ObjectId).toHexString()).toBe(eid);
  });

  it('период: даты YYYY-MM-DD — границы дня включительно', () => {
    const { filter } = parseAuditQuery({ from: '2026-10-01', to: '2026-10-18' });
    expect(filter.createdAt).toEqual({
      $gte: new Date('2026-10-01T00:00:00.000Z'),
      $lte: new Date('2026-10-18T23:59:59.999Z'),
    });
  });

  it('limit ограничен 200; мусор → 400 (не 500)', () => {
    expect(parseAuditQuery({ limit: '1000' }).limit).toBe(200);
    for (const bad of [{ userId: 'abc' }, { entityId: 'zzz' }, { page: '0' }, { from: 'вчера' }, { action: 'a b$' }, { from: '2026-10-18', to: '2026-10-01' }]) {
      expect(() => parseAuditQuery(bad)).toThrow(BadRequestException);
    }
  });
});
