import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { bumpSeverity, checkParams, hashOf, median, normName, plural, questionKey, severityRank, stableJson } from './question.rules';

describe('CC-14: правила вопросов', () => {
  it('ключ не зависит от порядка id и меняется с версией правила', () => {
    expect(questionKey('t', 'k', ['b', 'a'], 1)).toBe(questionKey('t', 'k', ['a', 'b'], 1));
    expect(questionKey('t', 'k', ['a'], 1)).not.toBe(questionKey('t', 'k', ['a'], 2));
    expect(questionKey('t', 'k', ['a'], 1)).not.toBe(questionKey('u', 'k', ['a'], 1));
  });
  it('хеш плана не зависит от порядка ключей, но замечает любое изменение', () => {
    expect(hashOf({ a: 1, b: { c: 2, d: 3 } })).toBe(hashOf({ b: { d: 3, c: 2 }, a: 1 }));
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
    expect(stableJson({ id: new Types.ObjectId('0123456789abcdef01234567') })).toContain('0123456789abcdef01234567');
  });
  it('параметры действия: лишнее отбрасывается, пустое и неверный id — 400', () => {
    expect(checkParams({ id: 'oid' }, { id: '0123456789abcdef01234567', x: 1 })).toEqual({ id: '0123456789abcdef01234567' });
    expect(() => checkParams({ id: 'oid' }, { id: 'abc' })).toThrow(BadRequestException);
    expect(() => checkParams({ dict: 'string' }, {})).toThrow(/Не указан/);
  });
  it('важность растёт на ступень и не выше высокой; медиана; нормализация имён; склонение', () => {
    expect(bumpSeverity('low')).toBe('medium');
    expect(bumpSeverity('high')).toBe('high');
    expect(severityRank('high')).toBeGreaterThan(severityRank('low'));
    expect(median([1, 5, 3])).toBe(3);
    expect(median([1, 3])).toBe(2);
    expect(median([])).toBeNull();
    expect(normName('  ООО   Ромашка ')).toBe('ооо ромашка');
    expect([1, 2, 5, 11, 21].map((n) => plural(n, ['запись', 'записи', 'записей']))).toEqual(['1 запись', '2 записи', '5 записей', '11 записей', '21 запись']);
  });
});
