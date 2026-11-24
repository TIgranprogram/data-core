import { liveFilter, livePipeline, rawAggregate, rawCount, rawFind } from './raw-query';

function col() {
  const calls: Array<{ op: string; filter?: unknown; pipeline?: unknown; options?: unknown }> = [];
  return {
    calls,
    find(filter: Record<string, unknown>, options?: object) { calls.push({ op: 'find', filter, options }); return 'find-cursor'; },
    countDocuments(filter: Record<string, unknown>, options?: object) { calls.push({ op: 'count', filter, options }); return 'count-promise'; },
    aggregate(pipeline: Record<string, unknown>[], options?: object) { calls.push({ op: 'agg', pipeline, options }); return 'agg-cursor'; },
  };
}

describe('raw-query — живые документы по умолчанию', () => {
  it('liveFilter добавляет deletedAt: null и не меняет вход', () => {
    const src = { status: 'open' };
    expect(liveFilter(src)).toEqual({ status: 'open', deletedAt: null });
    expect(src).toEqual({ status: 'open' });
    expect(liveFilter()).toEqual({ deletedAt: null });
  });

  it('includeDeleted и явный deletedAt не перетираются', () => {
    const gone = { deletedAt: { $ne: null } };
    expect(liveFilter(gone, { includeDeleted: true })).toBe(gone);
    expect(liveFilter(gone)).toBe(gone);
    expect(liveFilter({ deletedAt: null })).toEqual({ deletedAt: null });
  });

  it('rawFind и rawCount отдают фильтр и опции драйверу', () => {
    const db = col();
    const opt = { projection: { name: 1 } };
    expect(rawFind(db, { sku: 'A' }, opt)).toBe('find-cursor');
    expect(rawCount(db, {}, { limit: 1 }, { includeDeleted: true })).toBe('count-promise');
    expect(db.calls[0]).toEqual({ op: 'find', filter: { sku: 'A', deletedAt: null }, options: opt });
    expect(db.calls[1]).toEqual({ op: 'count', filter: {}, options: { limit: 1 } });
  });

  it('rawAggregate ставит живой $match, сливает первый $match и бережёт обязательную первую стадию', () => {
    const db = col();
    const plain = [{ $sort: { name: 1 } }];
    rawAggregate(db, plain, { allowDiskUse: true });
    const merged = [{ $match: { status: 'open' } }, { $limit: 5 }];
    rawAggregate(db, merged);
    const explicit = [{ $match: { deletedAt: { $ne: null } } }];
    rawAggregate(db, explicit);
    const near = [{ $geoNear: { near: { type: 'Point' } } }, { $limit: 1 }];
    rawAggregate(db, near);
    const kept = [{ $project: { name: 1 } }];
    rawAggregate(db, kept, undefined, { includeDeleted: true });

    expect(db.calls[0].pipeline).toEqual([{ $match: { deletedAt: null } }, { $sort: { name: 1 } }]);
    expect(db.calls[0].options).toEqual({ allowDiskUse: true });
    expect(plain).toEqual([{ $sort: { name: 1 } }]);
    expect(db.calls[1].pipeline).toEqual([{ $match: { status: 'open', deletedAt: null } }, { $limit: 5 }]);
    expect(db.calls[2].pipeline).toBe(explicit);
    expect(db.calls[3].pipeline).toEqual([near[0], { $match: { deletedAt: null } }, { $limit: 1 }]);
    expect(db.calls[4].pipeline).toBe(kept);
  });

  it('livePipeline на пустом пайплайне — только живой match', () => {
    expect(livePipeline([])).toEqual([{ $match: { deletedAt: null } }]);
  });
});
