import { BadRequestException } from '@nestjs/common';
import { parseTraits, whenProblem, WhenError, PASSPORT_TRAITS } from '../../common/passport/traits';
import type { DictBase, Field } from './dicts.defs';

const LIST = Object.entries(PASSPORT_TRAITS).map(([c, l]) => `${c} — ${l.toLowerCase()}`).join('; ');

/**
 * Признаки и условия справочников паспорта (C054): `traits` у видов изделия, материалов и способов установки — какие признаки
 * они несут; `when` у дефектов и оформления — при каких признаках запись попадает в паспорт. Только новые необязательные поля
 * записи (коллекция общая с kppdf). Ошибка в коде признака / строке условия — 400 при сохранении, а не молчаливое «не показывать».
 * Поле меняется, только если пришло в теле запроса: старый экран, не знающий про поле, его не стирает.
 */
export function withTraits(def: DictBase, opts: { traits?: boolean; when?: boolean }): DictBase {
  const extra: Field[] = [];
  if (opts.traits) extra.push({ key: 'traits', label: 'Признаки', tech: true, wide: true, hint: `Какие признаки несёт запись, через запятую: ${LIST}. От них зависят пункты текста паспорта` });
  if (opts.when) extra.push({ key: 'when', label: 'Условие', tech: true, wide: true, hint: `Когда запись попадает в паспорт: коды признаков, пробел — «и», | — «или», ! — «не». Пример: bolts|welds !freestanding. Пусто — всегда. Признаки: ${LIST}` });
  return {
    ...def,
    fields: [...def.fields, ...extra],
    row: (d) => ({ ...def.row(d), ...Object.fromEntries(extra.map((f) => [f.key, d[f.key] ?? ''])) }),
    toDoc: async (b, isNew, db, id) => {
      const doc = await def.toDoc(b, isNew, db, id);
      try {
        if (opts.traits && 'traits' in b) doc.traits = parseTraits(b.traits).join(', ') || null;
        if (opts.when && 'when' in b) {
          const w = String(b.when ?? '').replace(/\s+/g, ' ').trim();
          const problem = whenProblem(w);
          if (problem) throw new WhenError(problem);
          doc.when = w || null;
        }
      } catch (e) {
        if (e instanceof WhenError) throw new BadRequestException(e.message);
        throw e;
      }
      return doc;
    },
  };
}
