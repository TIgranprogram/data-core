import { BadRequestException } from '@nestjs/common';
import { promoteToOwn } from './passport-promote';

/** Перенос правки пункта в версию категории (БЗ-6 Э5a4). */
describe('promoteToOwn', () => {
  const all = [{ key: 'warranty', title: 'Гарантии', paragraphs: ['A1', 'A2', 'A3'] }, { key: 'storage', title: 'Хранение', paragraphs: ['S1'] }];
  it('нет раздела у категории — создаётся, предыдущие пункты берутся из «Для всех»', () => {
    const r = promoteToOwn(null, all, 'warranty', 'p3', 'Новый третий');
    expect(r).toEqual([{ key: 'warranty', title: 'Гарантии', paragraphs: ['A1', 'A2', 'Новый третий'] }]);
  });
  it('раздел есть — пункт заменяется, остальные разделы категории не трогаются', () => {
    const own = [{ key: 'warranty', title: 'Гарантии', paragraphs: ['C1'] }, { key: 'extra', title: 'Свой', paragraphs: ['E1', 'E2'] }];
    const r = promoteToOwn(own, all, 'warranty', 'p1', 'Своя гарантия');
    expect(r[0].paragraphs).toEqual(['Своя гарантия']);
    expect(r[1]).toEqual(own[1]);
    expect(own[0].paragraphs).toEqual(['C1']); // вход не меняется
    expect(promoteToOwn(own, all, 'extra', 'p2', 'Новый E2')[1].paragraphs).toEqual(['E1', 'Новый E2']);
  });
  it('неизвестный пункт или раздел, пустой текст — 400', () => {
    expect(() => promoteToOwn(null, all, 'warranty', 'x1', 't')).toThrow(BadRequestException);
    expect(() => promoteToOwn(null, all, 'nope', 'p1', 't')).toThrow(BadRequestException);
    expect(() => promoteToOwn(null, all, 'warranty', 'p1', ' ')).toThrow(BadRequestException);
  });
});
